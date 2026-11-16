import { combine, createEvent, createStore, sample } from "effector";
import { fromDateKey, localTimeZone, shiftCursor, startOfDay, toDateKey, viewRange, type ViewMode } from "../shared/lib/date";
import { readJson, writeJson } from "../shared/lib/storage";

const VIEW_KEY = "calm.view";
const isView = (v: unknown): v is ViewMode => v === "month" || v === "week" || v === "day" || v === "agenda";

export const viewChanged = createEvent<ViewMode>();
export const prevClicked = createEvent();
export const nextClicked = createEvent();
export const todayClicked = createEvent();
export const dateSelected = createEvent<Date>();
/** open a specific day in the "day" view */
export const dayOpened = createEvent<Date>();
export const minuteTicked = createEvent<Date>();

const storedView = readJson<unknown>(VIEW_KEY, "week");

export const $view = createStore<ViewMode>(isView(storedView) ? storedView : "week")
  .on(viewChanged, (_, v) => v)
  .on(dayOpened, () => "day");

const $cursorKey = createStore(toDateKey(new Date()))
  .on(todayClicked, () => toDateKey(new Date()))
  .on([dateSelected, dayOpened], (_, d) => toDateKey(d));

const $systemZone = createStore(localTimeZone())
  .on([minuteTicked, todayClicked, dateSelected, dayOpened, prevClicked, nextClicked, viewChanged], localTimeZone);

export const $cursor = combine($cursorKey, $systemZone, (key) => fromDateKey(key));

sample({
  clock: prevClicked,
  source: { view: $view, key: $cursorKey },
  fn: ({ view, key }) => toDateKey(shiftCursor(view, fromDateKey(key), -1)),
  target: $cursorKey,
});

sample({
  clock: nextClicked,
  source: { view: $view, key: $cursorKey },
  fn: ({ view, key }) => toDateKey(shiftCursor(view, fromDateKey(key), 1)),
  target: $cursorKey,
});

$view.watch((v) => writeJson(VIEW_KEY, v));

export const $range = combine($view, $cursor, viewRange);

/** current time to the minute: for the "now" line and highlighting today */
export const $now = createStore(new Date()).on(minuteTicked, (_, d) => d);
export const $today = $now.map(startOfDay);
