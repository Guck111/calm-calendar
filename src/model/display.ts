// Настройки показа: номера недель и календарь праздников. Хранятся только в этом приложении.
import { createEvent, createStore } from "effector";
import { broadcast } from "../shared/api/bus";
import { HOLIDAYS_KEY, isHolidayRegion } from "../shared/lib/holidays";
import { readJson, writeJson } from "../shared/lib/storage";
import { FEEDS_KEY, parseFeeds, type Feed } from "../shared/lib/feeds";

const WEEK_NUMBERS_KEY = "calm.weekNumbers";

export const weekNumbersToggled = createEvent<boolean>();
export const $weekNumbers = createStore(readJson<unknown>(WEEK_NUMBERS_KEY, false) === true).on(
  weekNumbersToggled,
  (_, v) => v,
);
$weekNumbers.updates.watch((v) => writeJson(WEEK_NUMBERS_KEY, v));

/** страна праздников (ключ из HOLIDAY_REGIONS); null — не показывать */
/** подписки на календари .ics по ссылке */
export const feedsChanged = createEvent<Feed[]>();
export const $feeds = createStore<Feed[]>(parseFeeds(readJson<unknown>(FEEDS_KEY, []))).on(feedsChanged, (_, v) =>
  parseFeeds(v),
);
$feeds.updates.watch((v) => {
  writeJson(FEEDS_KEY, v);
  // виджет и повестка в трее перечитают календари
  broadcast("events-changed", { from: "main" });
});

/** настройки сменили в отдельном окне — перечитываем сохранённые */
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
  // виджет и повестка в трее перечитают календари
  broadcast("events-changed", { from: "main" });
});
