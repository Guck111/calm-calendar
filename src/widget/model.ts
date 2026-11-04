// Модель виджета. Окно виджета — отдельная страница со своим состоянием,
// поэтому здесь своя лёгкая модель поверх тех же запросов к Google.
import { createEffect, createEvent, createStore, sample } from "effector";
import { getAuthStatus } from "../shared/api/bridge";
import { listCalendars, listEvents } from "../shared/api/calendar";
import type { AppError, AuthStatus, CalendarEvent } from "../shared/api/types";
import { addDays, monthGrid, startOfDay } from "../shared/lib/date";
import { readJson } from "../shared/lib/storage";

export const VISIBILITY_KEY = "calm.calendarVisibility";
const LOOK_AHEAD_DAYS = 45;

export const widgetStarted = createEvent();
export const authChanged = createEvent();
export const refreshRequested = createEvent();
export const minuteTicked = createEvent<Date>();

export const fetchStatusFx = createEffect<void, AuthStatus, AppError>(getAuthStatus);

export type WidgetData = { events: CalendarEvent[]; colors: Record<string, string> };

/** события с начала сетки текущего месяца и на полтора месяца вперёд */
export const fetchEventsFx = createEffect<Date, WidgetData, AppError>(async (today) => {
  const calendars = await listCalendars();
  const visibility = readJson<Record<string, boolean>>(VISIBILITY_KEY, {});
  const visible = calendars.filter((c) => visibility[c.id] ?? c.selected);
  const gridEnd = addDays(monthGrid(today)[41], 1);
  const ahead = addDays(startOfDay(today), LOOK_AHEAD_DAYS);
  const range = { start: monthGrid(today)[0], end: gridEnd > ahead ? gridEnd : ahead };
  const results = await Promise.allSettled(visible.map((c) => listEvents(c.id, range)));
  const events = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (visible.length && results.every((r) => r.status === "rejected")) {
    const first = results[0] as PromiseRejectedResult;
    throw first.reason as AppError;
  }
  return { events, colors: Object.fromEntries(calendars.map((c) => [c.id, c.color])) };
});

export const $now = createStore(new Date()).on(minuteTicked, (_, d) => d);
export const $today = $now.map(startOfDay);

export const $status = createStore<AuthStatus | null>(null).on(fetchStatusFx.doneData, (_, s) => s);
export const $signedIn = $status.map((s) => Boolean(s?.signedIn));

export const $data = createStore<WidgetData>({ events: [], colors: {} })
  .on(fetchEventsFx.doneData, (_, d) => d)
  .reset(fetchStatusFx.doneData.filter({ fn: (s) => !s.signedIn }));

export const $error = createStore<string | null>(null)
  .on(fetchEventsFx.doneData, () => null)
  .on(fetchEventsFx.failData, (_, e) => e.message);

export const $loading = fetchEventsFx.pending;

sample({ clock: [widgetStarted, authChanged], target: fetchStatusFx });

sample({
  clock: [fetchStatusFx.doneData, refreshRequested],
  source: { signedIn: $signedIn, now: $now },
  filter: ({ signedIn }) => signedIn,
  fn: ({ now }) => now,
  target: fetchEventsFx,
});

// с наступлением нового дня перечитываем: сменился месяц или диапазон
sample({
  clock: $today.updates,
  source: $signedIn,
  filter: Boolean,
  target: refreshRequested,
});

sample({
  clock: fetchEventsFx.failData,
  filter: (e) => e.kind === "not_signed_in",
  target: authChanged,
});
