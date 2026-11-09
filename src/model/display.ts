// Настройки показа: номера недель и календарь праздников. Хранятся только в этом приложении.
import { createEvent, createStore } from "effector";
import { isHolidayRegion } from "../shared/lib/holidays";
import { readJson, writeJson } from "../shared/lib/storage";

const WEEK_NUMBERS_KEY = "calm.weekNumbers";
const HOLIDAYS_KEY = "calm.holidays";

export const weekNumbersToggled = createEvent<boolean>();
export const $weekNumbers = createStore(readJson<unknown>(WEEK_NUMBERS_KEY, false) === true).on(
  weekNumbersToggled,
  (_, v) => v,
);
$weekNumbers.updates.watch((v) => writeJson(WEEK_NUMBERS_KEY, v));

/** страна праздников (ключ из HOLIDAY_REGIONS); null — не показывать */
export const holidayRegionChanged = createEvent<string | null>();
const stored = readJson<unknown>(HOLIDAYS_KEY, null);
export const $holidayRegion = createStore<string | null>(isHolidayRegion(stored) ? stored : null).on(
  holidayRegionChanged,
  (_, v) => (isHolidayRegion(v) ? v : null),
);
$holidayRegion.updates.watch((v) => writeJson(HOLIDAYS_KEY, v));
