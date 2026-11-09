import { findMeeting, type MeetingSource } from "../lib/meeting";
// Google Calendar API v3: календари и события
import { googleRequest, isAppError } from "./bridge";
import { cacheKey, markOffline, markOnline, recall, remember } from "./cache";
import { locale, t } from "../i18n";
import type { AccessRole, Calendar, CalendarEvent, EventDraft, EventTime, Scope } from "./types";
import { addDays, combineDateTime, fromDateKey, localTimeZone, toDateKey, type DateRange } from "../lib/date";
import { buildRecurrence, followStart, parseRecurrence, truncateBefore } from "../lib/rrule";

type Page<T> = { items?: T[]; nextPageToken?: string };

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
};

const enc = encodeURIComponent;

/** Чтение с запасом: ответ запоминаем, а без сети отдаём последний сохранённый */
export const readWithCache = async <T>(path: string, query: Record<string, string>): Promise<T> => {
  const key = cacheKey(path, query);
  try {
    const body = await googleRequest<T>("GET", path, query);
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

const fetchAllPages = async <T>(path: string, query: Record<string, string>): Promise<T[]> => {
  const items: T[] = [];
  let pageToken: string | undefined;
  do {
    const page = await readWithCache<Page<T>>(path, pageToken ? { ...query, pageToken } : query);
    items.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return items;
};

const toCalendar = (raw: RawCalendar): Calendar => ({
  id: raw.id,
  name: raw.summaryOverride ?? raw.summary ?? raw.id,
  color: raw.backgroundColor ?? "#8ab4f8",
  textColor: raw.foregroundColor ?? "#000000",
  accessRole: raw.accessRole,
  primary: Boolean(raw.primary),
  selected: Boolean(raw.selected),
  defaultReminders: popupMinutes(raw.defaultReminders),
});

const roleOrder = (c: Calendar): number => (c.primary ? 0 : c.accessRole === "owner" ? 1 : 2);

export const listCalendars = async (): Promise<Calendar[]> => {
  const raw = await fetchAllPages<RawCalendar>("/calendar/v3/users/me/calendarList", {
    minAccessRole: "reader",
  });
  return raw
    .filter((c) => !c.hidden)
    .map(toCalendar)
    .sort((a, b) => roleOrder(a) - roleOrder(b) || a.name.localeCompare(b.name, locale));
};

const parseTime = (t: RawTime | undefined): { date: Date; allDay: boolean } | null => {
  if (t?.dateTime) return { date: new Date(t.dateTime), allDay: false };
  if (t?.date) return { date: fromDateKey(t.date), allDay: true };
  return null;
};

export const toCalendarEvent = (calendarId: string, raw: RawEvent): CalendarEvent | null => {
  if (raw.status === "cancelled") return null;
  const start = parseTime(raw.start);
  const end = parseTime(raw.end);
  if (!start) return null;
  const fallbackEnd = start.allDay ? addDays(start.date, 1) : start.date;
  return {
    key: `${calendarId}\u0000${raw.id}`,
    id: raw.id,
    calendarId,
    title: raw.summary?.trim() || t.common.untitled,
    start: start.date,
    end: end && end.date > start.date ? end.date : fallbackEnd,
    allDay: start.allDay,
    location: raw.location,
    description: raw.description,
    htmlLink: raw.htmlLink,
    meeting: findMeeting(raw),
    recurring: Boolean(raw.recurringEventId),
    recurringEventId: raw.recurringEventId,
    originalStart: raw.originalStartTime,
    reminders: raw.reminders?.useDefault === false ? popupMinutes(raw.reminders.overrides) : "default",
  };
};

const eventsPath = (calendarId: string) => `/calendar/v3/calendars/${enc(calendarId)}/events`;

export const listEvents = async (calendarId: string, range: DateRange): Promise<CalendarEvent[]> => {
  const raw = await fetchAllPages<RawEvent>(eventsPath(calendarId), {
    singleEvents: "true",
    orderBy: "startTime",
    timeMin: range.start.toISOString(),
    timeMax: range.end.toISOString(),
    maxResults: "2500",
  });
  return raw.flatMap((e) => toCalendarEvent(calendarId, e) ?? []);
};

const SEARCH_SPAN_DAYS = 730;
const SEARCH_LIMIT = 50;

/** Поиск по названию, описанию и месту — силами Google, за два года в обе стороны */
export const searchEvents = async (calendarId: string, query: string, now: Date): Promise<CalendarEvent[]> => {
  const page = await googleRequest<Page<RawEvent>>("GET", eventsPath(calendarId), {
    q: query,
    singleEvents: "true",
    orderBy: "startTime",
    timeMin: addDays(now, -SEARCH_SPAN_DAYS).toISOString(),
    timeMax: addDays(now, SEARCH_SPAN_DAYS).toISOString(),
    maxResults: String(SEARCH_LIMIT),
  });
  return (page.items ?? []).flatMap((e) => toCalendarEvent(calendarId, e) ?? []);
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
  const time = (date: string, timeKey: string): RawTime | Record<string, string | null> =>
    draft.allDay
      ? { date, dateTime: null, timeZone: null }
      : { dateTime: combineDateTime(date, timeKey).toISOString(), timeZone: localTimeZone(), date: null };

  // в Google конец события на весь день не включительно
  const endDate = draft.allDay ? toDateKey(addDays(fromDateKey(draft.endDate), 1)) : draft.endDate;

  return {
    summary: draft.title.trim(),
    location: draft.location.trim(),
    description: draft.description.trim(),
    start: time(draft.startDate, draft.startTime),
    end: time(endDate, draft.endTime),
  };
};

const eventPath = (calendarId: string, eventId: string) => `${eventsPath(calendarId)}/${enc(eventId)}`;

/** Событие целиком, как его отдаёт Google: при разбиении серии копируем и поля, которых нет в форме */
type FullEvent = RawEvent & Record<string, unknown>;

export const getEvent = (calendarId: string, eventId: string): Promise<FullEvent> =>
  googleRequest<FullEvent>("GET", eventPath(calendarId, eventId));

/** Правило повтора серии: оно хранится у главного события, у повторений его нет */
export const loadRecurrence = async (calendarId: string, recurringEventId: string): Promise<string[]> =>
  (await getEvent(calendarId, recurringEventId)).recurrence ?? [];

const instant = (time: EventTime | undefined): Date | null =>
  time?.dateTime ? new Date(time.dateTime) : time?.date ? fromDateKey(time.date) : null;

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
  const from = instant(draft.originalStart) ?? draftStart(draft);
  const to = draftStart(draft);
  const { rule, extra } = parseRecurrence(original, from);
  if (!rule) return original;
  let next = followStart(rule, from, to);
  if (next.end.kind === "count") next = { ...next, end: { kind: "count", count: Math.max(1, next.end.count - countBefore) } };
  return buildRecurrence(next, extra, to, draft.allDay);
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
  return {
    kind: "split",
    create: { ...copied, ...body },
    truncate: { recurrence: truncateBefore(master.recurrence ?? [], split, Boolean(master.start?.date)) },
  };
};

/** Сколько повторений серии было до split, включая удалённые: они тоже считаются в COUNT */
const countBefore = async (calendarId: string, master: FullEvent, split: Date): Promise<number> => {
  let count = 0;
  let pageToken: string | undefined;
  do {
    const page = await googleRequest<Page<RawEvent>>("GET", `${eventPath(calendarId, master.id)}/instances`, {
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
    await googleRequest("PATCH", eventPath(calendarId, master.id), { conferenceDataVersion: "1" }, plan.patch);
    return;
  }
  const created = await googleRequest<RawEvent>("POST", eventsPath(calendarId), { conferenceDataVersion: "1" }, plan.create);
  try {
    await googleRequest("PATCH", eventPath(calendarId, master.id), undefined, plan.truncate);
  } catch (e) {
    // старую серию обрезать не вышло: убираем новую, чтобы повторения не задвоились
    await googleRequest("DELETE", eventPath(calendarId, created.id)).catch(() => {});
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
    await googleRequest("POST", eventsPath(draft.calendarId), undefined, body);
    return;
  }
  let calendarId = draft.originalCalendarId ?? draft.calendarId;
  if (calendarId !== draft.calendarId) {
    await googleRequest("POST", `${eventPath(calendarId, draft.id)}/move`, {
      destination: draft.calendarId,
    });
    calendarId = draft.calendarId;
  }
  await googleRequest("PATCH", eventPath(calendarId, draft.id), undefined, body);
};

export const deleteEvent = (calendarId: string, eventId: string): Promise<void> =>
  googleRequest("DELETE", eventPath(calendarId, eventId));

/** Удалить повторение: только его или его и все следующие (с первого — всю серию) */
export const deleteOccurrence = async (draft: EventDraft, scope: Scope): Promise<void> => {
  const calendarId = draft.originalCalendarId ?? draft.calendarId;
  if (!draft.recurringEventId || scope === "this") return deleteEvent(calendarId, draft.id ?? "");
  const master = await getEvent(calendarId, draft.recurringEventId);
  const split = instant(draft.originalStart);
  const first = instant(master.start);
  if (!split || !first || split <= first) return deleteEvent(calendarId, master.id);
  await googleRequest("PATCH", eventPath(calendarId, master.id), undefined, {
    recurrence: truncateBefore(master.recurrence ?? [], split, Boolean(master.start?.date)),
  });
};
