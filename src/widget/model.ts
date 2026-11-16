// Widget model. The widget window is a separate page with its own state,
// so it has its own lightweight model on top of the same Google requests.
import { combine, createEffect, createEvent, createStore, sample } from "effector";
import { getAuthStatus } from "../shared/api/bridge";
import { calendarVisible, listAllCalendars, listEvents } from "../shared/api/calendar";
import { forgetFeeds } from "../shared/api/feeds";
import type { AppError, AuthStatus, Calendar, CalendarEvent } from "../shared/api/types";
import { addDays, addMonths, isSameMonth, monthGrid, startOfDay, startOfMonth, type DateRange } from "../shared/lib/date";
import { HOLIDAYS_KEY, holidayCalendar } from "../shared/lib/holidays";
import { readJson } from "../shared/lib/storage";
import { FEEDS_KEY, feedCalendar, parseFeeds } from "../shared/lib/feeds";

export const VISIBILITY_KEY = "calm.calendarVisibility";
const LOOK_AHEAD_DAYS = 45;

export const widgetStarted = createEvent();
export const authChanged = createEvent();
export const refreshRequested = createEvent();
export const minuteTicked = createEvent<Date>();
export const monthShifted = createEvent<1 | -1>();
export const monthReset = createEvent();

// widget refresh re-downloads .ics subscriptions too
refreshRequested.watch(forgetFeeds);

export const fetchStatusFx = createEffect<void, AuthStatus, AppError>(getAuthStatus);

/** calendars of all accounts, holidays and subscriptions from settings, but only those enabled in the main window */
export const fetchCalendarsFx = createEffect<string[], Calendar[], AppError>(async (accounts) => {
  const { calendars } = await listAllCalendars(accounts);
  const holidays = holidayCalendar(readJson<string | null>(HOLIDAYS_KEY, null), accounts, calendars);
  const visibility = readJson<Record<string, boolean>>(VISIBILITY_KEY, {});
  const feeds = parseFeeds(readJson<unknown>(FEEDS_KEY, [])).map(feedCalendar);
  return [...calendars, ...(holidays ? [holidays] : []), ...feeds].filter((c) => calendarVisible(c, visibility));
});

const loadRange = async (calendars: Calendar[], range: DateRange): Promise<CalendarEvent[]> => {
  const results = await Promise.allSettled(calendars.map((c) => listEvents(c.id, range)));
  if (calendars.length && results.every((r) => r.status === "rejected")) {
    throw (results[0] as PromiseRejectedResult).reason as AppError;
  }
  return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
};

/** nearest events for the list at the bottom */
export const fetchUpcomingFx = createEffect<{ calendars: Calendar[]; today: Date }, CalendarEvent[], AppError>(
  ({ calendars, today }) => loadRange(calendars, { start: today, end: addDays(today, LOOK_AHEAD_DAYS) }),
);

/** events of the shown month's grid — for the dots */
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
export const $today = createStore(startOfDay($now.getState()), {
  updateFilter: (next, previous) => next.getTime() !== previous.getTime(),
}).on($now, (_, now) => startOfDay(now));

export const $month = createStore(startOfMonth(new Date()))
  .on(monthShifted, (m, step) => addMonths(m, step))
  .on(monthReset, () => startOfMonth(new Date()));

export const $isCurrentMonth = combine($month, $today, isSameMonth);

export const $status = createStore<AuthStatus | null>(null).on(fetchStatusFx.doneData, (_, s) => s);
/** accounts with valid sign-in */
const activeAccounts = (s: AuthStatus | null): string[] =>
  s && s.clientSource !== "none" ? s.accounts.filter((a) => a.signedIn).map((a) => a.email) : [];

export const $accounts = $status.map(activeAccounts);
export const $signedIn = $accounts.map((list) => list.length > 0);

const signedOut = fetchStatusFx.doneData.filter({ fn: (s) => activeAccounts(s).length === 0 });

export const $calendars = createStore<Calendar[]>([]).on(fetchCalendarsFx.doneData, (_, c) => c).reset(signedOut);
/** the calendar list has already been requested (successfully or not): before that "no calendars" means nothing yet */
export const $calendarsTried = createStore(false).on(fetchCalendarsFx.finally, () => true).reset(signedOut);

export const $colors = $calendars.map((list) => Object.fromEntries(list.map((c) => [c.id, c.color])));

// Responses are applied only for the latest request: two refreshes may finish in either order, and the month may
// return to one shown before (A → B → A), so neither the order nor the month tells a stale response apart.
// Effector hands the same params object to .done, so the latest one is kept and compared by reference.
type UpcomingRequest = Parameters<typeof fetchUpcomingFx>[0];
type MonthRequest = Parameters<typeof fetchMonthFx>[0];
const $upcomingRequest = createStore<UpcomingRequest | null>(null, { serialize: "ignore" }).on(fetchUpcomingFx, (_, p) => p);
const $monthRequest = createStore<MonthRequest | null>(null, { serialize: "ignore" }).on(fetchMonthFx, (_, p) => p);

const upcomingLoaded = sample({
  clock: fetchUpcomingFx.done,
  source: $upcomingRequest,
  filter: (latest, { params }) => latest === params,
  fn: (_, { result }) => result,
});
const upcomingFailed = sample({
  clock: fetchUpcomingFx.fail,
  source: $upcomingRequest,
  filter: (latest, { params }) => latest === params,
  fn: (_, { error }) => error,
});

export const $upcoming = createStore<CalendarEvent[]>([])
  .on(upcomingLoaded, (_, e) => e)
  .reset(signedOut);

export const $monthEvents = createStore<CalendarEvent[]>([]).reset(signedOut);

// while a new month is loading, the old month's dots are not shown
sample({ clock: $month.updates, fn: () => [], target: $monthEvents });

export const $error = createStore<string | null>(null)
  .on(upcomingLoaded, () => null)
  .on([fetchCalendarsFx.failData, upcomingFailed], (_, e) => e.message);

export const $loading = fetchUpcomingFx.pending;

sample({ clock: [widgetStarted, authChanged], target: fetchStatusFx });

sample({
  clock: [fetchStatusFx.doneData, refreshRequested],
  source: $accounts,
  filter: (accounts) => accounts.length > 0,
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

// a response for a month already paged past, or for an older load of the same month, is not applied
sample({
  clock: fetchMonthFx.done,
  source: { month: $month, latest: $monthRequest },
  filter: ({ month, latest }, { params, result }) => latest === params && month.getTime() === result.month.getTime(),
  fn: (_, { result }) => result.events,
  target: $monthEvents,
});

// when a new day starts, go back to the current month and reload
sample({ clock: $today.updates, target: monthReset });
sample({
  clock: $today.updates,
  source: $signedIn,
  filter: Boolean,
  target: refreshRequested,
});

sample({
  clock: [fetchCalendarsFx.failData, upcomingFailed],
  filter: (e) => e.kind === "not_signed_in",
  target: authChanged,
});
