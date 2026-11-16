// Display settings: week numbers and holiday calendar. Stored only in this app.
import { createEvent, createStore } from "effector";
import { broadcast } from "../shared/api/bus";
import { HOLIDAYS_KEY, isHolidayRegion } from "../shared/lib/holidays";
import { readJson, writeJson } from "../shared/lib/storage";
import { FEEDS_KEY, newFeed, parseFeeds, sameFeedUrl, type Feed } from "../shared/lib/feeds";

const WEEK_NUMBERS_KEY = "calm.weekNumbers";

export const weekNumbersToggled = createEvent<boolean>();
export const $weekNumbers = createStore(readJson<unknown>(WEEK_NUMBERS_KEY, false) === true).on(
  weekNumbersToggled,
  (_, v) => v,
);
$weekNumbers.updates.watch((v) => writeJson(WEEK_NUMBERS_KEY, v));

/** holiday country (key from HOLIDAY_REGIONS); null — don't show */
/** .ics calendar subscriptions by link */
export const feedsChanged = createEvent<Feed[]>();
/** a subscription downloaded and checked: added to the list as it is now, not as it was when the download started */
export const feedAdded = createEvent<{ url: string; name: string }>();
export const feedRemoved = createEvent<string>();
export const $feeds = createStore<Feed[]>(parseFeeds(readJson<unknown>(FEEDS_KEY, [])))
  .on(feedsChanged, (_, v) => parseFeeds(v))
  .on(feedAdded, (list, { url, name }) => (list.some((f) => sameFeedUrl(f.url, url)) ? list : [...list, newFeed(url, name, list)]))
  .on(feedRemoved, (list, id) => list.filter((f) => f.id !== id));
$feeds.updates.watch((v) => {
  writeJson(FEEDS_KEY, v);
  // the widget and tray agenda will reload calendars
  broadcast("events-changed", { from: "main" });
});

/** settings changed in a separate window — reload the saved ones */
export const displayReloaded = () => {
  feedsChanged(parseFeeds(readJson<unknown>(FEEDS_KEY, [])));
  weekNumbersToggled(readJson<unknown>(WEEK_NUMBERS_KEY, false) === true);
  const region = readJson<unknown>(HOLIDAYS_KEY, null);
  holidayRegionChanged(isHolidayRegion(region) ? region : null);
};

export const holidayRegionChanged = createEvent<string | null>();
const stored = readJson<unknown>(HOLIDAYS_KEY, null);
export const $holidayRegion = createStore<string | null>(isHolidayRegion(stored) ? stored : null).on(
  holidayRegionChanged,
  (_, v) => (isHolidayRegion(v) ? v : null),
);
$holidayRegion.updates.watch((v) => {
  writeJson(HOLIDAYS_KEY, v);
  // the widget and tray agenda will reload calendars
  broadcast("events-changed", { from: "main" });
});
