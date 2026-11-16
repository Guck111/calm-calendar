// Subscriptions to .ics calendars by link. The list is stored only in the app (localStorage shared by
// the main window, settings and widget): such a calendar can't be added to Google without a new scope.
import { calendarRef } from "../api/calendar";
import type { Calendar } from "../api/types";

export const FEEDS_KEY = "calm.feeds";
/** instead of the account email for subscription calendars */
export const FEED_ACCOUNT = "ics";

export type Feed = { id: string; url: string; name: string; color: string };

/** subscription colors in rotation: calm, unlike Google's default calendar colors */
export const FEED_COLORS = ["#8e63ce", "#e6804d", "#3d9a8b", "#c2537a", "#6d7f99", "#b8913a"];

const isFeed = (v: unknown): v is Feed => {
  const f = v as Partial<Feed> | null;
  return Boolean(f && typeof f.id === "string" && typeof f.url === "string" && typeof f.name === "string" && typeof f.color === "string");
};

/** the list from storage; corrupted entries are skipped */
export const parseFeeds = (v: unknown): Feed[] => (Array.isArray(v) ? v.filter(isFeed) : []);

/** webcal:// and https:// with the same address are one subscription */
export const sameFeedUrl = (a: string, b: string): boolean => {
  const norm = (u: string) => u.trim().replace(/^webcal:\/\//i, "https://").replace(/\/+$/, "").toLowerCase();
  return norm(a) === norm(b);
};

/** default name is the site address: "calendar.example.com" */
export const feedNameFromUrl = (url: string): string => {
  try {
    return new URL(url.trim().replace(/^webcal:\/\//i, "https://")).hostname || url;
  } catch {
    return url;
  }
};

/** the link looks like a link: check before downloading to report a typo right away */
export const looksLikeUrl = (url: string): boolean => /^(https?|webcal):\/\/[^\s/]+\.[^\s]+$/i.test(url.trim());

export const newFeed = (url: string, name: string, existing: Feed[], id = crypto.randomUUID()): Feed => ({
  id,
  url: url.trim(),
  name: name.trim() || feedNameFromUrl(url),
  color: FEED_COLORS[existing.length % FEED_COLORS.length],
});

export const feedCalendar = (f: Feed): Calendar => ({
  id: calendarRef(FEED_ACCOUNT, f.id),
  googleId: f.id,
  account: FEED_ACCOUNT,
  name: f.name,
  color: f.color,
  textColor: "#000000",
  accessRole: "reader",
  primary: false,
  selected: true,
  defaultReminders: [],
  feed: true,
});
