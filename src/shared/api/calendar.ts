import { findMeeting, type MeetingSource } from "../lib/meeting";
// Google Calendar API v3: calendars and events
import { googleRequest, isAppError, type HttpMethod } from "./bridge";
import { cacheKey, markOffline, markOnline, recall, remember } from "./cache";
import { listFeedEvents, searchFeedEvents } from "./feeds";
import { FEED_ACCOUNT } from "../lib/feeds";
import { locale, t } from "../i18n";
import type {
  AccessRole,
  AppError,
  Attachment,
  Attendee,
  Calendar,
  CalendarEvent,
  EventDraft,
  EventTime,
  Scope,
} from "./types";
import { addDays, combineDateTime, fromDateKey, localTimeZone, toDateKey, type DateRange } from "../lib/date";
import { fromZoned, fromZonedParts, isTimeZone, wallClock } from "../lib/tz";
import { isColorId } from "../lib/colors";

/** time zone whose clock defines the date and time in the draft */
export const draftZone = (d: EventDraft): string => d.timeZone ?? localTimeZone();
import { buildRecurrence, filterRDates, followStart, parseRecurrence, truncateBefore } from "../lib/rrule";

export const draftInstant = (draft: EventDraft, bound: "start" | "end"): Date => {
  const zone = draftZone(draft);
  const original = draft.originalTimes?.zone === zone ? draft.originalTimes[bound] : undefined;
  return fromZoned(draft[`${bound}Date`], draft[`${bound}Time`], zone, original);
};

/** Google also gives the calendar time zone with the event list */
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

// popup reminders; email reminders are not shown as notifications
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
  attachments?: (Attachment & { iconLink?: string })[];
};

/** attachment without extra fields: the UI doesn't load the icon image (iconLink), it has its own icon */
const cleanAttachment = (a: Attachment): Attachment => ({
  fileUrl: a.fileUrl,
  title: a.title || a.fileUrl,
  ...(a.mimeType ? { mimeType: a.mimeType } : {}),
  ...(a.fileId ? { fileId: a.fileId } : {}),
});

/** travel time key in the event's hidden fields: only our app sees them */
export const TRAVEL_KEY = "calmTravelMinutes";

const parseTravel = (raw: RawEvent): number | undefined => {
  const n = Number(raw.extendedProperties?.private?.[TRAVEL_KEY]);
  return Number.isFinite(n) && n > 0 && n <= 24 * 60 ? Math.round(n) : undefined;
};

/** meeting guests without extra fields: that's how we send them back to Google */
const cleanAttendee = (a: Attendee): Attendee => ({
  email: a.email,
  ...(a.displayName ? { displayName: a.displayName } : {}),
  ...(a.responseStatus ? { responseStatus: a.responseStatus } : {}),
  ...(a.optional ? { optional: true } : {}),
});

/** whether there is anyone to send invitations to: someone other than the account itself */
export const hasGuests = (list: Attendee[] | undefined): boolean => Boolean(list?.some((a) => !a.self));

const enc = encodeURIComponent;

const SEP = "\u0000";

/** calendar id inside the app: two accounts may have the same Google calendar */
export const calendarRef = (account: string, googleId: string): string => `${account}${SEP}${googleId}`;

export const splitRef = (ref: string): { account: string; googleId: string } => {
  const at = ref.indexOf(SEP);
  return at < 0 ? { account: "", googleId: ref } : { account: ref.slice(0, at), googleId: ref.slice(at + 1) };
};

/** Read with a fallback: remember the response, and without network return the last saved one */
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

/** Whether a calendar is enabled: manual setting, then the setting from the pre-multi-account version (by Google id),
 *  then the choice in Google itself */
export const calendarVisible = (c: Calendar, visibility: Record<string, boolean>): boolean =>
  visibility[c.id] ?? visibility[c.googleId] ?? c.selected;

export type AllCalendars = {
  /** by account in sign-in order */
  calendars: Calendar[];
  /** accounts whose calendars failed to load */
  failed: string[];
  /** accounts where Google no longer accepts the sign-in */
  lost: string[];
};

/** Calendars of all accounts. An error only if no account responded */
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

const OFFSET_FREE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/i;

const parseTime = (t: RawTime | undefined, fallbackZone?: string): { date: Date; allDay: boolean } | null => {
  if (t?.dateTime) {
    const zone = t.timeZone ?? fallbackZone;
    const local = OFFSET_FREE.exec(t.dateTime);
    if (local && isTimeZone(zone)) {
      const [, y, mo, d, h, mi, s = "0", fraction = ""] = local;
      const date = fromZonedParts(+y, +mo, +d, +h, +mi, +s, zone);
      date.setUTCMilliseconds(Number(fraction.padEnd(3, "0").slice(0, 3)));
      return { date, allDay: false };
    }
    return { date: new Date(t.dateTime), allDay: false };
  }
  if (t?.date) return { date: fromDateKey(t.date), allDay: true };
  return null;
};

/** calendarZone — the calendar's time zone: an event without its own time zone is in it */
export const toCalendarEvent = (calendarId: string, raw: RawEvent, calendarZone?: string): CalendarEvent | null => {
  if (raw.status === "cancelled") return null;
  const start = parseTime(raw.start, calendarZone);
  if (!start) return null;
  const fallbackEnd = start.allDay ? addDays(start.date, 1) : start.date;
  const timeZone = start.allDay ? undefined : (raw.start?.timeZone ?? calendarZone);
  const end = parseTime(raw.end, timeZone);
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
    // Google doesn't send self: false; an event without an organizer is our own
    organizerSelf: raw.organizer ? raw.organizer.self === true : true,
    ...(isColorId(raw.colorId) ? { colorId: raw.colorId } : {}),
    ...(raw.attachments?.length ? { attachments: raw.attachments.filter((a) => a.fileUrl).map(cleanAttachment) } : {}),
  };
};

const eventsPath = (googleId: string) => `/calendar/v3/calendars/${enc(googleId)}/events`;

/** Request to a calendar's events: account and Google id come from the app calendar id */
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

/** path of a single event relative to the calendar's events */
const one = (eventId: string) => `/${enc(eventId)}`;

export const listEvents = async (calendarId: string, range: DateRange): Promise<CalendarEvent[]> => {
  const { account, googleId } = splitRef(calendarId);
  // .ics subscription: a file by link, Google is not involved
  if (account === FEED_ACCOUNT) return listFeedEvents(calendarId, range);
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

/** Search by title, description and location — done by Google, two years in both directions */
export const searchEvents = async (calendarId: string, query: string, now: Date): Promise<CalendarEvent[]> => {
  if (splitRef(calendarId).account === FEED_ACCOUNT) {
    const range = { start: addDays(now, -SEARCH_SPAN_DAYS), end: addDays(now, SEARCH_SPAN_DAYS) };
    return searchFeedEvents(calendarId, query, range, SEARCH_LIMIT);
  }
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

/** Nearest upcoming first, then past ones from newest to oldest */
export const sortByRelevance = (events: CalendarEvent[], now: Date): CalendarEvent[] => {
  const future = events.filter((e) => e.end >= now).sort((a, b) => a.start.getTime() - b.start.getTime());
  const past = events.filter((e) => e.end < now).sort((a, b) => b.start.getTime() - a.start.getTime());
  return [...future, ...past];
};

/** Request body for events.insert / events.patch. The unused field is cleared explicitly,
 *  so the event switches correctly between "all day" and timed. */
export const draftToBody = (draft: EventDraft) => {
  // date and time in the form follow the event's time zone clock; for an existing event it's its time zone from Google
  const zone = draftZone(draft);
  // in Google the end of an all-day event is exclusive
  const endDate = draft.allDay ? toDateKey(addDays(fromDateKey(draft.endDate), 1)) : draft.endDate;
  const time = (bound: "start" | "end", label: string): RawTime | Record<string, string | null> =>
    draft.allDay
      ? { date: bound === "start" ? draft.startDate : endDate, dateTime: null, timeZone: null }
      : { dateTime: draftInstant(draft, bound).toISOString(), timeZone: label, date: null };

  return {
    summary: draft.title.trim(),
    location: draft.location.trim(),
    description: draft.description.trim(),
    start: time("start", zone),
    end: time("end", draft.endTimeZone ?? zone),
    // patch merges objects: the event's other hidden fields stay
    ...(draft.travelMinutes !== undefined
      ? { extendedProperties: { private: { [TRAVEL_KEY]: String(draft.travelMinutes) } } }
      : {}),
    ...(draft.guests !== undefined ? { attendees: draft.guests.map(cleanAttendee) } : {}),
    ...(sendsAttachments(draft) ? { attachments: (draft.attachments ?? []).map(cleanAttachment) } : {}),
    // own color; for an existing event "calendar color" means resetting colorId
    ...(draft.colorId ? { colorId: draft.colorId } : draft.colorId === "" && draft.id ? { colorId: null } : {}),
    // Google creates the meeting itself and sends the link; requestId must not repeat
    ...(draft.addMeet
      ? { conferenceData: { createRequest: { requestId: requestId(), conferenceSolutionKey: { type: "hangoutsMeet" } } } }
      : {}),
  };
};

const requestId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** attachments go to Google only if the list was changed: editing and dragging don't touch them */
const sendsAttachments = (draft: EventDraft): boolean => Boolean(draft.attachmentsChanged && draft.attachments);

/** Guests get an email about a new meeting, a move or a cancellation, as in Google Calendar */
const notify = (draft: EventDraft): Record<string, string> | undefined =>
  hasGuests(draft.guests) ? { sendUpdates: "all" } : undefined;

/** save parameters: emails to guests and, for a new video meeting, conferenceData support */
const saveQuery = (draft: EventDraft): Record<string, string> | undefined => {
  const query = {
    ...(draft.addMeet ? { conferenceDataVersion: "1" } : {}),
    // without this Google doesn't change attachments
    ...(sendsAttachments(draft) ? { supportsAttachments: "true" } : {}),
    ...notify(draft),
  };
  return Object.keys(query).length ? query : undefined;
};

/** The whole event as Google returns it: when splitting a series, also copy fields that are not in the form */
type FullEvent = RawEvent & Record<string, unknown>;

export const getEvent = (calendarId: string, eventId: string): Promise<FullEvent> =>
  api<FullEvent>(calendarId, "GET", one(eventId));

/** Series recurrence rule: it is stored on the master event, occurrences don't have it */
export const loadRecurrence = async (calendarId: string, recurringEventId: string): Promise<string[]> =>
  (await getEvent(calendarId, recurringEventId)).recurrence ?? [];

const instant = (time: EventTime | undefined, zone?: string): Date | null => parseTime(time, zone)?.date ?? null;

/** When a series occurrence is scheduled by the rule (originalStart), even if it was moved to another time;
 *  for a regular event — its start. "This and following" is counted from it, as when deleting in Google */
export const occurrenceStart = (e: Pick<CalendarEvent, "start" | "originalStart" | "timeZone">): Date =>
  instant(e.originalStart, e.timeZone) ?? e.start;

/** the same time in the event's time zone clock: the recurrence rule counts weekdays and dates by it */
const wallInstant = (time: EventTime | undefined, zone: string): Date | null => {
  const date = instant(time, zone);
  return date && time?.dateTime ? wallClock(date, zone) : date;
};

/** event start by its time zone clock (not an instant) */
const draftStart = (d: EventDraft): Date =>
  d.allDay ? fromDateKey(d.startDate) : combineDateTime(d.startDate, d.startTime);

const sameLines = (a: string[], b: string[]) => a.join("\n") === b.join("\n");

/** the rule in the form was changed (if the series rule didn't load, editing is impossible) */
export const recurrenceEdited = (d: EventDraft): boolean =>
  d.originalRecurrence !== undefined && !sameLines(d.recurrence, d.originalRecurrence);

const hasCount = (lines: string[]) => {
  const rules = lines.filter((line) => /^RRULE:/i.test(line));
  return rules.length === 1 && /(?:^RRULE:|;)COUNT=\d+(?:;|$)/i.test(rules[0]);
};

const seriesZone = (draft: EventDraft, master: RawEvent): string =>
  master.start?.timeZone ?? draft.originalStart?.timeZone ?? draft.originalTimes?.zone ?? draftZone(draft);

/** Rule for occurrences "from this one on". If the rule wasn't edited, it follows the new start
 *  ("every Wednesday" → "every Thursday"), and the occurrence count is reduced by those already passed */
export const followingRecurrence = (draft: EventDraft, master: RawEvent, countBefore: number): string[] => {
  const original = master.recurrence ?? [];
  if (recurrenceEdited(draft)) return draft.recurrence;
  const zone = draftZone(draft);
  const originalZone = seriesZone(draft, master);
  const from = wallInstant(draft.originalStart, originalZone) ?? draftStart(draft);
  const to = draftStart(draft);
  const { rule, extra } = parseRecurrence(original, from, originalZone);
  if (!rule) return original;
  let next = followStart(rule, from, to);
  if (next.end.kind === "count") next = { ...next, end: { kind: "count", count: Math.max(1, next.end.count - countBefore) } };
  return buildRecurrence(next, extra, to, draft.allDay, zone);
};

/** master event fields that carry over to the new series: attendees, video meeting, reminders… */
const COPIED = [
  "summary",
  "description",
  "location",
  "colorId",
  "attachments",
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
  /** editing from the first occurrence means editing the whole series */
  | { kind: "series"; patch: Record<string, unknown> }
  /** otherwise a new series from this occurrence, and the old one ends before it */
  | { kind: "split"; create: Record<string, unknown>; truncate: { recurrence: string[] } };

export const planFollowing = (draft: EventDraft, master: FullEvent, countBefore: number): FollowingPlan => {
  const body = { ...draftToBody(draft), recurrence: followingRecurrence(draft, master, countBefore) };
  const zone = seriesZone(draft, master);
  const split = instant(draft.originalStart, zone);
  const first = instant(master.start, zone);
  if (!split || !first || split <= first) return { kind: "series", patch: body };
  const copied = Object.fromEntries(COPIED.filter((k) => k in master).map((k) => [k, master[k]]));
  // the new series also keeps the master event's foreign hidden fields, not only travel time
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
    create: { ...copied, ...body, ...props, recurrence: filterRDates(body.recurrence, split, "following", zone) },
    truncate: { recurrence: truncateBefore(master.recurrence ?? [], split, Boolean(master.start?.date), zone) },
  };
};

/** How many series occurrences there were before split, including deleted ones: they count in COUNT too */
const countBefore = async (calendarId: string, master: FullEvent, split: Date, zone: string): Promise<number> => {
  let count = 0;
  let pageToken: string | undefined;
  // timeMax looks at the actual start: moved occurrences may start after split.
  do {
    const page = await api<Page<RawEvent>>(calendarId, "GET", `${one(master.id)}/instances`, {
      showDeleted: "true",
      maxResults: "2500",
      ...(pageToken ? { pageToken } : {}),
    });
    count += (page.items ?? []).filter((e) => {
      const at = instant(e.originalStartTime ?? e.start, master.start?.timeZone ?? page.timeZone ?? zone);
      return at !== null && at < split;
    }).length;
    pageToken = page.nextPageToken;
  } while (pageToken);
  return count;
};

const saveFollowing = async (draft: EventDraft): Promise<void> => {
  const calendarId = draft.originalCalendarId ?? draft.calendarId;
  const master = await getEvent(calendarId, draft.recurringEventId ?? "");
  const zone = seriesZone(draft, master);
  const split = instant(draft.originalStart, zone);
  const needCount = split && !recurrenceEdited(draft) && hasCount(master.recurrence ?? []);
  const plan = planFollowing(draft, master, needCount ? await countBefore(calendarId, master, split, zone) : 0);
  if (plan.kind === "series") {
    await api(calendarId, "PATCH", one(master.id), { conferenceDataVersion: "1", supportsAttachments: "true", ...notify(draft) }, plan.patch);
    return;
  }
  // the master event's attachments carry over to the new series
  const query = { conferenceDataVersion: "1", supportsAttachments: "true", ...notify(draft) };
  const created = await api<RawEvent>(calendarId, "POST", "", query, plan.create);
  try {
    await api(calendarId, "PATCH", one(master.id), undefined, plan.truncate);
  } catch (e) {
    // failed to trim the old series: remove the new one so occurrences aren't duplicated
    await api(calendarId, "DELETE", one(created.id)).catch(() => {});
    throw e;
  }
};

/** Fields of the request body that a form field writes */
const BODY_FIELDS: Partial<Record<keyof EventDraft, string[]>> = {
  title: ["summary"],
  location: ["location"],
  description: ["description"],
  allDay: ["start", "end"],
  startDate: ["start", "end"],
  startTime: ["start", "end"],
  endDate: ["start", "end"],
  endTime: ["start", "end"],
  timeZone: ["start", "end"],
  endTimeZone: ["start", "end"],
  travelMinutes: ["extendedProperties"],
  guests: ["attendees"],
  attachments: ["attachments"],
  colorId: ["colorId"],
  addMeet: ["conferenceData"],
};

/** Quick change of an existing event without the form (drag, Ctrl+K): only the changed fields go to Google.
 *  Two quick changes in a row each carry a copy of the event from before the other one; a full body would put
 *  the other change back (a new color, then a drag that sends the old color) */
export const patchEvent = async (draft: EventDraft & { id: string }, changed: (keyof EventDraft)[]): Promise<void> => {
  const full: Record<string, unknown> = draftToBody(draft);
  const keys = new Set(changed.flatMap((k) => BODY_FIELDS[k] ?? []));
  const body = Object.fromEntries(Object.entries(full).filter(([k]) => keys.has(k)));
  await api(draft.originalCalendarId ?? draft.calendarId, "PATCH", one(draft.id), saveQuery(draft), body);
};

/** a move without the form: only start and end */
export const moveEvent = (draft: EventDraft & { id: string }): Promise<void> => patchEvent(draft, ["startDate", "endDate"]);

export const saveEvent = async (draft: EventDraft, scope: Scope = "this"): Promise<void> => {
  if (draft.recurringEventId && scope === "following") return saveFollowing(draft);
  const body = {
    ...draftToBody(draft),
    // a series occurrence has no rule of its own; for a regular event the rule turns it into a series
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
    // Google moves an event only between calendars of one account; the form doesn't offer others
    if (from.account !== to.account) throw { kind: "other", message: t.errors.otherAccount };
    await api(calendarId, "POST", `${one(draft.id)}/move`, { destination: to.googleId });
    calendarId = draft.calendarId;
  }
  await api(calendarId, "PATCH", one(draft.id), saveQuery(draft), body);
};

export type ResponseStatus = NonNullable<Attendee["responseStatus"]>;

/** Own response to an invitation; undefined — the meeting is our own or the account is not in the guest list */
export const myResponse = (e: CalendarEvent): ResponseStatus | undefined => {
  if (e.organizerSelf !== false) return undefined;
  const me = e.attendees?.find((a) => a.self);
  return me ? (me.responseStatus ?? "needsAction") : undefined;
};

/** Respond to an invitation. attendeesOmitted: only our own response goes to Google, the other guests' list
 *  is left alone (Google may send it incomplete). For a series occurrence — the response to this occurrence */
export const respondToEvent = async (e: CalendarEvent, status: ResponseStatus): Promise<void> => {
  const me = e.attendees?.find((a) => a.self);
  if (!me) throw { kind: "other", message: "not invited" };
  await api(e.calendarId, "PATCH", one(e.id), { sendUpdates: "all" }, {
    attendeesOmitted: true,
    attendees: [{ email: me.email, responseStatus: status }],
  });
};

/** the same event with our new response */
export const withResponse = (e: CalendarEvent, status: ResponseStatus): CalendarEvent => ({
  ...e,
  attendees: e.attendees?.map((a) => (a.self ? { ...a, responseStatus: status } : a)),
});

export const deleteEvent = (calendarId: string, eventId: string, query?: Record<string, string>): Promise<void> =>
  api(calendarId, "DELETE", one(eventId), query);

/** Delete an occurrence: only it or it and all following (from the first — the whole series) */
export const deleteOccurrence = async (draft: EventDraft, scope: Scope): Promise<void> => {
  const calendarId = draft.originalCalendarId ?? draft.calendarId;
  // guests get a cancellation email
  if (!draft.recurringEventId || scope === "this") return deleteEvent(calendarId, draft.id ?? "", notify(draft));
  const master = await getEvent(calendarId, draft.recurringEventId);
  const zone = seriesZone(draft, master);
  const split = instant(draft.originalStart, zone);
  const first = instant(master.start, zone);
  if (!split || !first || split <= first) return deleteEvent(calendarId, master.id, notify(draft));
  await api(calendarId, "PATCH", one(master.id), undefined, {
    recurrence: truncateBefore(master.recurrence ?? [], split, Boolean(master.start?.date), zone),
  });
};
