// Loading .ics subscriptions: Rust downloads the file (fetch_feed), lib/ics parses it.
// The parsed file is kept in memory for 10 minutes: views and the widget ask for events often, and the file changes rarely.
// The last downloaded text is kept in localStorage — without network the subscription shows it.
import { t } from "../i18n";
import { expandIcs, parseIcs, type IcsCalendar } from "../lib/ics";
import { FEED_ACCOUNT, FEEDS_KEY, parseFeeds, type Feed } from "../lib/feeds";
import type { DateRange } from "../lib/date";
import { readJson } from "../lib/storage";
import { fetchFeed } from "./bridge";
import { splitRef } from "./calendar";
import type { CalendarEvent } from "./types";

const FRESH_MS = 10 * 60_000;
/** don't save text larger than this: localStorage for the whole app is about 5 MB */
const SAVE_LIMIT = 1_500_000;
const savedKey = (id: string) => `calm.feedCache.${id}`;

const memory = new Map<string, { at: number; url: string; cal: IcsCalendar }>();

/** "Refresh" button: the next request re-downloads subscriptions */
export const forgetFeeds = (): void => memory.clear();

/** remove saved data of a deleted subscription */
export const dropFeedCache = (id: string): void => {
  memory.delete(id);
  try {
    localStorage.removeItem(savedKey(id));
  } catch {
    // storage is unavailable — nothing to remove
  }
};

/** the file contains a calendar: an empty calendar is still a calendar, but a website page is not */
export const isCalendarText = (text: string): boolean => /BEGIN:VCALENDAR/i.test(text);

/** Download and parse the file by link; not a calendar — an error with a clear text */
export const downloadFeed = async (url: string): Promise<IcsCalendar> => {
  const text = await fetchFeed(url);
  if (!isCalendarText(text)) throw { kind: "other", message: t.settings.feedNotIcs };
  return parseIcs(text);
};

const loadFeed = async (feed: Feed): Promise<IcsCalendar> => {
  const cached = memory.get(feed.id);
  if (cached && cached.url === feed.url && Date.now() - cached.at < FRESH_MS) return cached.cal;
  try {
    const text = await fetchFeed(feed.url);
    if (!isCalendarText(text)) throw { kind: "other", message: t.settings.feedNotIcs };
    const cal = parseIcs(text);
    memory.set(feed.id, { at: Date.now(), url: feed.url, cal });
    try {
      if (text.length <= SAVE_LIMIT) localStorage.setItem(savedKey(feed.id), text);
    } catch {
      // no space — without network the subscription just won't be visible
    }
    return cal;
  } catch (e) {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(savedKey(feed.id));
    } catch {
      saved = null;
    }
    if (saved === null) throw e;
    const cal = parseIcs(saved);
    memory.set(feed.id, { at: Date.now(), url: feed.url, cal });
    return cal;
  }
};

const feedOf = (calendarId: string): Feed | undefined => {
  const { googleId } = splitRef(calendarId);
  return parseFeeds(readJson<unknown>(FEEDS_KEY, [])).find((f) => f.id === googleId);
};

/** subscription events in a range */
export const listFeedEvents = async (calendarId: string, range: DateRange): Promise<CalendarEvent[]> => {
  const feed = feedOf(calendarId);
  if (!feed) return [];
  return expandIcs(await loadFeed(feed), range, calendarId, FEED_ACCOUNT, t.common.untitled);
};

/** subscription search: in title, location and description, over the same period Google searches */
export const searchFeedEvents = async (calendarId: string, query: string, range: DateRange, limit: number): Promise<CalendarEvent[]> => {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const events = await listFeedEvents(calendarId, range);
  return events
    .filter((e) => [e.title, e.location, e.description].some((v) => v?.toLocaleLowerCase().includes(needle)))
    .slice(0, limit);
};
