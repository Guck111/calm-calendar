import { findMeeting, type MeetingSource } from "../lib/meeting";
// Google Calendar API v3: календари и события
import { googleRequest, isAppError, type HttpMethod } from "./bridge";
import { cacheKey, markOffline, markOnline, recall, remember } from "./cache";
import { locale, t } from "../i18n";
import type {
  AccessRole,
  AppError,
  Attendee,
  Calendar,
  CalendarEvent,
  EventDraft,
  EventTime,
  Scope,
} from "./types";
import { addDays, combineDateTime, fromDateKey, localTimeZone, toDateKey, type DateRange } from "../lib/date";
import { fromZoned, wallClock } from "../lib/tz";
import { isColorId } from "../lib/colors";

/** пояс, по часам которого заданы дата и время в черновике */
export const draftZone = (d: EventDraft): string => d.timeZone ?? localTimeZone();
import { buildRecurrence, followStart, parseRecurrence, truncateBefore } from "../lib/rrule";

/** у списка событий Google указывает и пояс календаря */
type Page<T> = { items?: T[]; nextPageToken?: string; timeZone?: string };

type RawCalendar = {
  id: string;
  summary?: string;
  summaryOverride?: string;
  backgroundColor?: string;
  foregroundColor?: string;
  accessRole: AccessRole;
  primary?: boolean;
  selected?: boolean;
  hidden?: boolean;
  defaultReminders?: RawReminder[];
  timeZone?: string;
};

type RawReminder = { method?: string; minutes?: number };

// всплывающие напоминания; письма на почту уведомлением не показываем
const popupMinutes = (list: RawReminder[] | undefined): number[] =>
  (list ?? []).filter((r) => r.method === "popup" && typeof r.minutes === "number").map((r) => r.minutes as number);

type RawTime = EventTime;

export type RawEvent = {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  description?: string;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: MeetingSource["conferenceData"];
  start?: RawTime;
  end?: RawTime;
  recurringEventId?: string;
  originalStartTime?: RawTime;
  recurrence?: string[];
  reminders?: { useDefault?: boolean; overrides?: RawReminder[] };
  iCalUID?: string;
  transparency?: string;
  attendees?: Attendee[];
  organizer?: { email?: string; self?: boolean };
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
  colorId?: string;
};

/** ключ времени в пути в скрытых полях события: их видит только наше приложение */
export const TRAVEL_KEY = "calmTravelMinutes";

const parseTravel = (raw: RawEvent): number | undefined => {
  const n = Number(raw.extendedProperties?.private?.[TRAVEL_KEY]);
  return Number.isFinite(n) && n > 0 && n <= 24 * 60 ? Math.round(n) : undefined;
};

/** гости встречи без лишних полей: так их и отправляем обратно в Google */
const cleanAttendee = (a: Attendee): Attendee => ({
  email: a.email,
  ...(a.displayName ? { displayName: a.displayName } : {}),
  ...(a.responseStatus ? { responseStatus: a.responseStatus } : {}),
  ...(a.optional ? { optional: true } : {}),
});

/** есть ли кому слать приглашения: кто-то, кроме самого аккаунта */
export const hasGuests = (list: Attendee[] | undefined): boolean => Boolean(list?.some((a) => !a.self));

const enc = encodeURIComponent;

const SEP = "\u0000";

/** id календаря внутри приложения: у двух аккаунтов может быть один и тот же календарь Google */
export const calendarRef = (account: string, googleId: string): string => `${account}${SEP}${googleId}`;

export const splitRef = (ref: string): { account: string; googleId: string } => {
  const at = ref.indexOf(SEP);
  return at < 0 ? { account: "", googleId: ref } : { account: ref.slice(0, at), googleId: ref.slice(at + 1) };
};

/** Чтение с запасом: ответ запоминаем, а без сети отдаём последний сохранённый */
export const readWithCache = async <T>(account: string, path: string, query: Record<string, string>): Promise<T> => {
  const key = `${account}|${cacheKey(path, query)}`;
  try {
    const body = await googleRequest<T>(account, "GET", path, query);
    remember(key, body);
    markOnline();
    return body;
  } catch (e) {
    const saved = isAppError(e) && e.kind === "network" ? recall(key) : undefined;
    if (!saved) throw e;
    markOffline(saved.at);
    return saved.body as T;
  }
};

const fetchPages = async <T>(
  account: string,
  path: string,
  query: Record<string, string>,
): Promise<{ items: T[]; timeZone?: string }> => {
  const items: T[] = [];
  let timeZone: string | undefined;
  let pageToken: string | undefined;
  do {
    const page = await readWithCache<Page<T>>(account, path, pageToken ? { ...query, pageToken } : query);
    items.push(...(page.items ?? []));
    timeZone ??= page.timeZone;
    pageToken = page.nextPageToken;
  } while (pageToken);
  return { items, timeZone };
};

const fetchAllPages = async <T>(account: string, path: string, query: Record<string, string>): Promise<T[]> =>
  (await fetchPages<T>(account, path, query)).items;

const toCalendar = (account: string, raw: RawCalendar): Calendar => ({
  id: calendarRef(account, raw.id),
  googleId: raw.id,
  account,
  name: raw.summaryOverride ?? raw.summary ?? raw.id,
  color: raw.backgroundColor ?? "#8ab4f8",
  textColor: raw.foregroundColor ?? "#000000",
  accessRole: raw.accessRole,
  primary: Boolean(raw.primary),
  selected: Boolean(raw.selected),
  defaultReminders: popupMinutes(raw.defaultReminders),
  timeZone: raw.timeZone,
});

const roleOrder = (c: Calendar): number => (c.primary ? 0 : c.accessRole === "owner" ? 1 : 2);

export const listCalendars = async (account: string): Promise<Calendar[]> => {
  const raw = await fetchAllPages<RawCalendar>(account, "/calendar/v3/users/me/calendarList", {
    minAccessRole: "reader",
  });
  return raw
    .filter((c) => !c.hidden)
    .map((c) => toCalendar(account, c))
    .sort((a, b) => roleOrder(a) - roleOrder(b) || a.name.localeCompare(b.name, locale));
};

/** Включён ли календарь: ручная настройка, затем настройка версии до нескольких аккаунтов (по id в Google),
 *  затем выбор в самом Google */
export const calendarVisible = (c: Calendar, visibility: Record<string, boolean>): boolean =>
  visibility[c.id] ?? visibility[c.googleId] ?? c.selected;

export type AllCalendars = {
  /** по аккаунтам в порядке входа */
  calendars: Calendar[];
  /** аккаунты, чьи календари не загрузились */
  failed: string[];
  /** аккаунты, где Google больше не принимает вход */
  lost: string[];
};

/** Календари всех аккаунтов. Ошибка — только если не ответил ни один аккаунт */
export const listAllCalendars = async (accounts: string[]): Promise<AllCalendars> => {
  const results = await Promise.allSettled(accounts.map((a) => listCalendars(a)));
  const rejected = (i: number) => results[i].status === "rejected";
  const reason = (i: number) => (results[i] as PromiseRejectedResult).reason as unknown;
  if (accounts.length && accounts.every((_, i) => rejected(i))) throw reason(0);
  return {
    calendars: results.flatMap((r) => (r.status === "fulfilled" ? r.value : [])),
    failed: accounts.filter((_, i) => rejected(i)),
    lost: accounts.filter((_, i) => rejected(i) && isAppError(reason(i)) && (reason(i) as AppError).kind === "not_signed_in"),
  };
};

const parseTime = (t: RawTime | undefined): { date: Date; allDay: boolean } | null => {
  if (t?.dateTime) return { date: new Date(t.dateTime), allDay: false };
  if (t?.date) return { date: fromDateKey(t.date), allDay: true };
  return null;
};

/** calendarZone — пояс календаря: в нём событие, у которого свой пояс не указан */
export const toCalendarEvent = (calendarId: string, raw: RawEvent, calendarZone?: string): CalendarEvent | null => {
  if (raw.status === "cancelled") return null;
  const start = parseTime(raw.start);
  const end = parseTime(raw.end);
  if (!start) return null;
  const fallbackEnd = start.allDay ? addDays(start.date, 1) : start.date;
  const timeZone = start.allDay ? undefined : (raw.start?.timeZone ?? calendarZone);
  const endTimeZone = raw.end?.timeZone && raw.end.timeZone !== timeZone ? raw.end.timeZone : undefined;
  return {
    key: `${calendarId}\u0000${raw.id}`,
    id: raw.id,
    calendarId,
    account: splitRef(calendarId).account,
    iCalUID: raw.iCalUID,
    free: raw.transparency === "transparent",
    title: raw.summary?.trim() || t.common.untitled,
    start: start.date,
    end: end && end.date > start.date ? end.date : fallbackEnd,
    allDay: start.allDay,
    ...(timeZone ? { timeZone } : {}),
    ...(endTimeZone && !start.allDay ? { endTimeZone } : {}),
    location: raw.location,
    description: raw.description,
    htmlLink: raw.htmlLink,
    meeting: findMeeting(raw),
    recurring: Boolean(raw.recurringEventId),
    recurringEventId: raw.recurringEventId,
    originalStart: raw.originalStartTime,
    reminders: raw.reminders?.useDefault === false ? popupMinutes(raw.reminders.overrides) : "default",
    ...(parseTravel(raw) ? { travelMinutes: parseTravel(raw) } : {}),
    ...(raw.attendees?.length ? { attendees: raw.attendees } : {}),
    // self: false Google не присылает; без организатора событие своё
    organizerSelf: raw.organizer ? raw.organizer.self === true : true,
    ...(isColorId(raw.colorId) ? { colorId: raw.colorId } : {}),
  };
};

const eventsPath = (googleId: string) => `/calendar/v3/calendars/${enc(googleId)}/events`;

/** Запрос к событиям календаря: аккаунт и id в Google берутся из id календаря в приложении */
const api = <T = unknown>(
  calendar: string,
  method: HttpMethod,
  suffix: string,
  query?: Record<string, string>,
  body?: unknown,
): Promise<T> => {
  const { account, googleId } = splitRef(calendar);
  return googleRequest<T>(account, method, `${eventsPath(googleId)}${suffix}`, query, body);
};

/** путь одного события относительно событий календаря */
const one = (eventId: string) => `/${enc(eventId)}`;

export const listEvents = async (calendarId: string, range: DateRange): Promise<CalendarEvent[]> => {
  const { account, googleId } = splitRef(calendarId);
  const { items, timeZone } = await fetchPages<RawEvent>(account, eventsPath(googleId), {
    singleEvents: "true",
    orderBy: "startTime",
    timeMin: range.start.toISOString(),
    timeMax: range.end.toISOString(),
    maxResults: "2500",
  });
  return items.flatMap((e) => toCalendarEvent(calendarId, e, timeZone) ?? []);
};

const SEARCH_SPAN_DAYS = 730;
const SEARCH_LIMIT = 50;

/** Поиск по названию, описанию и месту — силами Google, за два года в обе стороны */
export const searchEvents = async (calendarId: string, query: string, now: Date): Promise<CalendarEvent[]> => {
  const page = await api<Page<RawEvent>>(calendarId, "GET", "", {
    q: query,
    singleEvents: "true",
    orderBy: "startTime",
    timeMin: addDays(now, -SEARCH_SPAN_DAYS).toISOString(),
    timeMax: addDays(now, SEARCH_SPAN_DAYS).toISOString(),
    maxResults: String(SEARCH_LIMIT),
  });
  return (page.items ?? []).flatMap((e) => toCalendarEvent(calendarId, e, page.timeZone) ?? []);
};

/** Ближайшие будущие сначала, потом прошедшие от новых к старым */
export const sortByRelevance = (events: CalendarEvent[], now: Date): CalendarEvent[] => {
  const future = events.filter((e) => e.end >= now).sort((a, b) => a.start.getTime() - b.start.getTime());
  const past = events.filter((e) => e.end < now).sort((a, b) => b.start.getTime() - a.start.getTime());
  return [...future, ...past];
};

/** Тело запроса для events.insert / events.patch. Лишнее поле обнуляем явно,
 *  чтобы событие корректно переключалось между «весь день» и временем. */
export const draftToBody = (draft: EventDraft) => {
  // дата и время в форме — по часам пояса события; у существующего события это его пояс из Google
  const zone = draftZone(draft);
  const time = (date: string, timeKey: string, label = zone): RawTime | Record<string, string | null> =>
    draft.allDay
      ? { date, dateTime: null, timeZone: null }
      : { dateTime: fromZoned(date, timeKey, zone).toISOString(), timeZone: label, date: null };

  // в Google конец события на весь день не включительно
  const endDate = draft.allDay ? toDateKey(addDays(fromDateKey(draft.endDate), 1)) : draft.endDate;

  return {
    summary: draft.title.trim(),
    location: draft.location.trim(),
    description: draft.description.trim(),
    start: time(draft.startDate, draft.startTime),
    end: time(endDate, draft.endTime, draft.endTimeZone ?? zone),
    // patch сливает объекты: другие скрытые поля события остаются
    ...(draft.travelMinutes !== undefined
      ? { extendedProperties: { private: { [TRAVEL_KEY]: String(draft.travelMinutes) } } }
      : {}),
    ...(draft.guests !== undefined ? { attendees: draft.guests.map(cleanAttendee) } : {}),
    // свой цвет; у существующего события «цвет календаря» — это сброс colorId
    ...(draft.colorId ? { colorId: draft.colorId } : draft.colorId === "" && draft.id ? { colorId: null } : {}),
    // Google сам создаёт встречу и присылает ссылку; requestId не должен повторяться
    ...(draft.addMeet
      ? { conferenceData: { createRequest: { requestId: requestId(), conferenceSolutionKey: { type: "hangoutsMeet" } } } }
      : {}),
  };
};

const requestId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** Гостям — письмо о новой встрече, переносе или отмене, как в Google Календаре */
const notify = (draft: EventDraft): Record<string, string> | undefined =>
  hasGuests(draft.guests) ? { sendUpdates: "all" } : undefined;

/** параметры сохранения: письма гостям и, для новой видеовстречи, поддержка conferenceData */
const saveQuery = (draft: EventDraft): Record<string, string> | undefined => {
  const query = { ...(draft.addMeet ? { conferenceDataVersion: "1" } : {}), ...notify(draft) };
  return Object.keys(query).length ? query : undefined;
};

/** Событие целиком, как его отдаёт Google: при разбиении серии копируем и поля, которых нет в форме */
type FullEvent = RawEvent & Record<string, unknown>;

export const getEvent = (calendarId: string, eventId: string): Promise<FullEvent> =>
  api<FullEvent>(calendarId, "GET", one(eventId));

/** Правило повтора серии: оно хранится у главного события, у повторений его нет */
export const loadRecurrence = async (calendarId: string, recurringEventId: string): Promise<string[]> =>
  (await getEvent(calendarId, recurringEventId)).recurrence ?? [];

const instant = (time: EventTime | undefined): Date | null =>
  time?.dateTime ? new Date(time.dateTime) : time?.date ? fromDateKey(time.date) : null;

/** то же время по часам пояса события: правило повтора считает дни недели и числа по ним */
const wallInstant = (time: EventTime | undefined, zone: string): Date | null =>
  time?.dateTime ? wallClock(new Date(time.dateTime), zone) : instant(time);

/** начало события по часам его пояса (не момент времени) */
const draftStart = (d: EventDraft): Date =>
  d.allDay ? fromDateKey(d.startDate) : combineDateTime(d.startDate, d.startTime);

const sameLines = (a: string[], b: string[]) => a.join("\n") === b.join("\n");

/** правило в форме поменяли (если правило серии не загрузилось, правка невозможна) */
export const recurrenceEdited = (d: EventDraft): boolean =>
  d.originalRecurrence !== undefined && !sameLines(d.recurrence, d.originalRecurrence);

const hasCount = (lines: string[]) => lines.some((l) => /^RRULE:(?:.*;)?COUNT=/i.test(l));

/** Правило для повторений «с этого и дальше». Если правило не правили, оно следует за новым началом
 *  («каждую среду» → «каждый четверг»), а число повторов уменьшается на уже прошедшие */
export const followingRecurrence = (draft: EventDraft, master: RawEvent, countBefore: number): string[] => {
  const original = master.recurrence ?? [];
  if (recurrenceEdited(draft)) return draft.recurrence;
  const zone = draftZone(draft);
  const from = wallInstant(draft.originalStart, zone) ?? draftStart(draft);
  const to = draftStart(draft);
  const { rule, extra } = parseRecurrence(original, from, zone);
  if (!rule) return original;
  let next = followStart(rule, from, to);
  if (next.end.kind === "count") next = { ...next, end: { kind: "count", count: Math.max(1, next.end.count - countBefore) } };
  return buildRecurrence(next, extra, to, draft.allDay, zone);
};

/** поля главного события, которые переходят в новую серию: участники, видеовстреча, напоминания… */
const COPIED = [
  "summary",
  "description",
  "location",
  "colorId",
  "attendees",
  "reminders",
  "conferenceData",
  "visibility",
  "transparency",
  "guestsCanInviteOthers",
  "guestsCanModify",
  "guestsCanSeeOtherGuests",
  "anyoneCanAddSelf",
  "source",
  "extendedProperties",
];

export type FollowingPlan =
  /** правка с первого повторения — это правка всей серии */
  | { kind: "series"; patch: Record<string, unknown> }
  /** иначе новая серия с этого повторения, а старая заканчивается перед ним */
  | { kind: "split"; create: Record<string, unknown>; truncate: { recurrence: string[] } };

export const planFollowing = (draft: EventDraft, master: FullEvent, countBefore: number): FollowingPlan => {
  const body = { ...draftToBody(draft), recurrence: followingRecurrence(draft, master, countBefore) };
  const split = instant(draft.originalStart);
  const first = instant(master.start);
  if (!split || !first || split <= first) return { kind: "series", patch: body };
  const copied = Object.fromEntries(COPIED.filter((k) => k in master).map((k) => [k, master[k]]));
  // в новой серии сохраняем и чужие скрытые поля главного события, а не только время в пути
  const props = body.extendedProperties
    ? {
        extendedProperties: {
          ...master.extendedProperties,
          private: { ...master.extendedProperties?.private, ...body.extendedProperties.private },
        },
      }
    : {};
  return {
    kind: "split",
    create: { ...copied, ...body, ...props },
    truncate: { recurrence: truncateBefore(master.recurrence ?? [], split, Boolean(master.start?.date)) },
  };
};

/** Сколько повторений серии было до split, включая удалённые: они тоже считаются в COUNT */
const countBefore = async (calendarId: string, master: FullEvent, split: Date): Promise<number> => {
  let count = 0;
  let pageToken: string | undefined;
  do {
    const page = await api<Page<RawEvent>>(calendarId, "GET", `${one(master.id)}/instances`, {
      showDeleted: "true",
      timeMax: split.toISOString(),
      maxResults: "2500",
      ...(pageToken ? { pageToken } : {}),
    });
    count += (page.items ?? []).filter((e) => {
      const at = instant(e.originalStartTime ?? e.start);
      return at !== null && at < split;
    }).length;
    pageToken = page.nextPageToken;
  } while (pageToken);
  return count;
};

const saveFollowing = async (draft: EventDraft): Promise<void> => {
  const calendarId = draft.originalCalendarId ?? draft.calendarId;
  const master = await getEvent(calendarId, draft.recurringEventId ?? "");
  const split = instant(draft.originalStart);
  const needCount = split && !recurrenceEdited(draft) && hasCount(master.recurrence ?? []);
  const plan = planFollowing(draft, master, needCount ? await countBefore(calendarId, master, split) : 0);
  if (plan.kind === "series") {
    await api(calendarId, "PATCH", one(master.id), { conferenceDataVersion: "1", ...notify(draft) }, plan.patch);
    return;
  }
  const query = { conferenceDataVersion: "1", ...notify(draft) };
  const created = await api<RawEvent>(calendarId, "POST", "", query, plan.create);
  try {
    await api(calendarId, "PATCH", one(master.id), undefined, plan.truncate);
  } catch (e) {
    // старую серию обрезать не вышло: убираем новую, чтобы повторения не задвоились
    await api(calendarId, "DELETE", one(created.id)).catch(() => {});
    throw e;
  }
};

export const saveEvent = async (draft: EventDraft, scope: Scope = "this"): Promise<void> => {
  if (draft.recurringEventId && scope === "following") return saveFollowing(draft);
  const body = {
    ...draftToBody(draft),
    // у повторения серии своего правила нет; у обычного события правило превращает его в серию
    ...(!draft.recurringEventId && draft.recurrence.length ? { recurrence: draft.recurrence } : {}),
  };
  if (!draft.id) {
    await api(draft.calendarId, "POST", "", saveQuery(draft), body);
    return;
  }
  let calendarId = draft.originalCalendarId ?? draft.calendarId;
  if (calendarId !== draft.calendarId) {
    const from = splitRef(calendarId);
    const to = splitRef(draft.calendarId);
    // Google переносит событие только между календарями одного аккаунта; форма другого не предлагает
    if (from.account !== to.account) throw { kind: "other", message: t.errors.otherAccount };
    await api(calendarId, "POST", `${one(draft.id)}/move`, { destination: to.googleId });
    calendarId = draft.calendarId;
  }
  await api(calendarId, "PATCH", one(draft.id), saveQuery(draft), body);
};

export type ResponseStatus = NonNullable<Attendee["responseStatus"]>;

/** Свой ответ на приглашение; undefined — встреча своя или аккаунт не в списке гостей */
export const myResponse = (e: CalendarEvent): ResponseStatus | undefined => {
  if (e.organizerSelf !== false) return undefined;
  const me = e.attendees?.find((a) => a.self);
  return me ? (me.responseStatus ?? "needsAction") : undefined;
};

/** Ответить на приглашение. attendeesOmitted: в Google уходит только свой ответ, список остальных гостей
 *  не трогаем (Google может прислать его не целиком). У повторения серии — ответ на это повторение */
export const respondToEvent = async (e: CalendarEvent, status: ResponseStatus): Promise<void> => {
  const me = e.attendees?.find((a) => a.self);
  if (!me) throw { kind: "other", message: "not invited" };
  await api(e.calendarId, "PATCH", one(e.id), { sendUpdates: "all" }, {
    attendeesOmitted: true,
    attendees: [{ email: me.email, responseStatus: status }],
  });
};

/** то же событие с новым своим ответом */
export const withResponse = (e: CalendarEvent, status: ResponseStatus): CalendarEvent => ({
  ...e,
  attendees: e.attendees?.map((a) => (a.self ? { ...a, responseStatus: status } : a)),
});

export const deleteEvent = (calendarId: string, eventId: string, query?: Record<string, string>): Promise<void> =>
  api(calendarId, "DELETE", one(eventId), query);

/** Удалить повторение: только его или его и все следующие (с первого — всю серию) */
export const deleteOccurrence = async (draft: EventDraft, scope: Scope): Promise<void> => {
  const calendarId = draft.originalCalendarId ?? draft.calendarId;
  // гостям — письмо об отмене
  if (!draft.recurringEventId || scope === "this") return deleteEvent(calendarId, draft.id ?? "", notify(draft));
  const master = await getEvent(calendarId, draft.recurringEventId);
  const split = instant(draft.originalStart);
  const first = instant(master.start);
  if (!split || !first || split <= first) return deleteEvent(calendarId, master.id, notify(draft));
  await api(calendarId, "PATCH", one(master.id), undefined, {
    recurrence: truncateBefore(master.recurrence ?? [], split, Boolean(master.start?.date)),
  });
};
