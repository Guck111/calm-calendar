// Модель виджета. Окно виджета — отдельная страница со своим состоянием,
// поэтому здесь своя лёгкая модель поверх тех же запросов к Google.
import { combine, createEffect, createEvent, createStore, sample } from "effector";
import { getAuthStatus } from "../shared/api/bridge";
import { listCalendars, listEvents } from "../shared/api/calendar";
import type { AppError, AuthStatus, Calendar, CalendarEvent } from "../shared/api/types";
import { addDays, addMonths, isSameMonth, monthGrid, startOfDay, startOfMonth, type DateRange } from "../shared/lib/date";
import { readJson } from "../shared/lib/storage";

export const VISIBILITY_KEY = "calm.calendarVisibility";
const LOOK_AHEAD_DAYS = 45;

export const widgetStarted = createEvent();
export const authChanged = createEvent();
export const refreshRequested = createEvent();
export const minuteTicked = createEvent<Date>();
export const monthShifted = createEvent<1 | -1>();
export const monthReset = createEvent();

export const fetchStatusFx = createEffect<void, AuthStatus, AppError>(getAuthStatus);

/** только календари, включённые в главном окне */
export const fetchCalendarsFx = createEffect<void, Calendar[], AppError>(async () => {
  const calendars = await listCalendars();
  const visibility = readJson<Record<string, boolean>>(VISIBILITY_KEY, {});
  return calendars.filter((c) => visibility[c.id] ?? c.selected);
});

const loadRange = async (calendars: Calendar[], range: DateRange): Promise<CalendarEvent[]> => {
  const results = await Promise.allSettled(calendars.map((c) => listEvents(c.id, range)));
  if (calendars.length && results.every((r) => r.status === "rejected")) {
    throw (results[0] as PromiseRejectedResult).reason as AppError;
  }
  return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
};

/** ближайшие события для списка внизу */
export const fetchUpcomingFx = createEffect<{ calendars: Calendar[]; today: Date }, CalendarEvent[], AppError>(
  ({ calendars, today }) => loadRange(calendars, { start: today, end: addDays(today, LOOK_AHEAD_DAYS) }),
);

/** события сетки показанного месяца — для точек */
export const fetchMonthFx = createEffect<
  { calendars: Calendar[]; month: Date },
  { month: Date; events: CalendarEvent[] },
  AppError
>(async ({ calendars, month }) => {
  const grid = monthGrid(month);
  const events = await loadRange(calendars, { start: grid[0], end: addDays(grid[41], 1) });
  return { month, events };
});

export const $now = createStore(new Date()).on(minuteTicked, (_, d) => d);
export const $today = $now.map(startOfDay);

export const $month = createStore(startOfMonth(new Date()))
  .on(monthShifted, (m, step) => addMonths(m, step))
  .on(monthReset, () => startOfMonth(new Date()));

export const $isCurrentMonth = combine($month, $today, isSameMonth);

export const $status = createStore<AuthStatus | null>(null).on(fetchStatusFx.doneData, (_, s) => s);
export const $signedIn = $status.map((s) => Boolean(s?.signedIn) && s?.clientSource !== "none");

const signedOut = fetchStatusFx.doneData.filter({ fn: (s) => !s.signedIn });

export const $calendars = createStore<Calendar[]>([]).on(fetchCalendarsFx.doneData, (_, c) => c).reset(signedOut);

export const $colors = $calendars.map((list) => Object.fromEntries(list.map((c) => [c.id, c.color])));

export const $upcoming = createStore<CalendarEvent[]>([])
  .on(fetchUpcomingFx.doneData, (_, e) => e)
  .reset(signedOut);

export const $monthEvents = createStore<CalendarEvent[]>([]).reset(signedOut);

// пока грузится новый месяц, точки старого не показываем
sample({ clock: $month.updates, fn: () => [], target: $monthEvents });

export const $error = createStore<string | null>(null)
  .on(fetchUpcomingFx.doneData, () => null)
  .on([fetchCalendarsFx.failData, fetchUpcomingFx.failData], (_, e) => e.message);

export const $loading = fetchUpcomingFx.pending;

sample({ clock: [widgetStarted, authChanged], target: fetchStatusFx });

sample({
  clock: [fetchStatusFx.doneData, refreshRequested],
  source: $signedIn,
  filter: Boolean,
  target: fetchCalendarsFx,
});

sample({
  clock: fetchCalendarsFx.doneData,
  source: $today,
  fn: (today, calendars) => ({ calendars, today }),
  target: fetchUpcomingFx,
});

sample({
  clock: [fetchCalendarsFx.doneData, $month.updates],
  source: { calendars: $calendars, month: $month, signedIn: $signedIn },
  filter: ({ signedIn }) => signedIn,
  fn: ({ calendars, month }) => ({ calendars, month }),
  target: fetchMonthFx,
});

// ответ по месяцу, который уже перелистнули, не применяем
sample({
  clock: fetchMonthFx.doneData,
  source: $month,
  filter: (month, r) => month.getTime() === r.month.getTime(),
  fn: (_, r) => r.events,
  target: $monthEvents,
});

// с наступлением нового дня возвращаемся к текущему месяцу и перечитываем
sample({ clock: $today.updates, target: monthReset });
sample({
  clock: $today.updates,
  source: $signedIn,
  filter: Boolean,
  target: refreshRequested,
});

sample({
  clock: [fetchCalendarsFx.failData, fetchUpcomingFx.failData],
  filter: (e) => e.kind === "not_signed_in",
  target: authChanged,
});
