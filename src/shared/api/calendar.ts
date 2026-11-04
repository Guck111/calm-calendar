// Google Calendar API v3: календари и события
import { googleRequest } from "./bridge";
import type { AccessRole, Calendar, CalendarEvent, EventDraft } from "./types";
import { addDays, combineDateTime, fromDateKey, localTimeZone, toDateKey, type DateRange } from "../lib/date";

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
};

type RawTime = { date?: string; dateTime?: string; timeZone?: string };

type RawEvent = {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  description?: string;
  htmlLink?: string;
  start?: RawTime;
  end?: RawTime;
  recurringEventId?: string;
};

const enc = encodeURIComponent;

const fetchAllPages = async <T>(path: string, query: Record<string, string>): Promise<T[]> => {
  const items: T[] = [];
  let pageToken: string | undefined;
  do {
    const page = await googleRequest<Page<T>>("GET", path, pageToken ? { ...query, pageToken } : query);
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
});

const roleOrder = (c: Calendar): number => (c.primary ? 0 : c.accessRole === "owner" ? 1 : 2);

export const listCalendars = async (): Promise<Calendar[]> => {
  const raw = await fetchAllPages<RawCalendar>("/calendar/v3/users/me/calendarList", {
    minAccessRole: "reader",
  });
  return raw
    .filter((c) => !c.hidden)
    .map(toCalendar)
    .sort((a, b) => roleOrder(a) - roleOrder(b) || a.name.localeCompare(b.name, "ru"));
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
    title: raw.summary?.trim() || "(без названия)",
    start: start.date,
    end: end && end.date > start.date ? end.date : fallbackEnd,
    allDay: start.allDay,
    location: raw.location,
    description: raw.description,
    htmlLink: raw.htmlLink,
    recurring: Boolean(raw.recurringEventId),
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

export const saveEvent = async (draft: EventDraft): Promise<void> => {
  const body = draftToBody(draft);
  if (!draft.id) {
    await googleRequest("POST", eventsPath(draft.calendarId), undefined, body);
    return;
  }
  let calendarId = draft.originalCalendarId ?? draft.calendarId;
  if (calendarId !== draft.calendarId) {
    await googleRequest("POST", `${eventsPath(calendarId)}/${enc(draft.id)}/move`, {
      destination: draft.calendarId,
    });
    calendarId = draft.calendarId;
  }
  await googleRequest("PATCH", `${eventsPath(calendarId)}/${enc(draft.id)}`, undefined, body);
};

export const deleteEvent = (calendarId: string, eventId: string): Promise<void> =>
  googleRequest("DELETE", `${eventsPath(calendarId)}/${enc(eventId)}`);
