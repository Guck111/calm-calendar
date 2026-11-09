import { combine, createEvent, createStore, sample } from "effector";
import { shiftCursor, startOfDay, viewRange, type ViewMode } from "../shared/lib/date";
import { readJson, writeJson } from "../shared/lib/storage";

const VIEW_KEY = "calm.view";
const isView = (v: unknown): v is ViewMode => v === "month" || v === "week" || v === "day" || v === "agenda";

export const viewChanged = createEvent<ViewMode>();
export const prevClicked = createEvent();
export const nextClicked = createEvent();
export const todayClicked = createEvent();
export const dateSelected = createEvent<Date>();
/** открыть конкретный день в виде «день» */
export const dayOpened = createEvent<Date>();
export const minuteTicked = createEvent<Date>();

const storedView = readJson<unknown>(VIEW_KEY, "week");

export const $view = createStore<ViewMode>(isView(storedView) ? storedView : "week")
  .on(viewChanged, (_, v) => v)
  .on(dayOpened, () => "day");

export const $cursor = createStore(startOfDay(new Date()))
  .on(todayClicked, () => startOfDay(new Date()))
  .on([dateSelected, dayOpened], (_, d) => startOfDay(d));

sample({
  clock: prevClicked,
  source: { view: $view, cursor: $cursor },
  fn: ({ view, cursor }) => shiftCursor(view, cursor, -1),
  target: $cursor,
});

sample({
  clock: nextClicked,
  source: { view: $view, cursor: $cursor },
  fn: ({ view, cursor }) => shiftCursor(view, cursor, 1),
  target: $cursor,
});

$view.watch((v) => writeJson(VIEW_KEY, v));

export const $range = combine($view, $cursor, viewRange);

/** текущее время с точностью до минуты: для линии «сейчас» и подсветки сегодняшнего дня */
export const $now = createStore(new Date()).on(minuteTicked, (_, d) => d);
export const $today = $now.map(startOfDay);
