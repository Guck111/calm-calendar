import { combine, createEffect, createEvent, createStore, sample } from "effector";
import { calendarVisible, listAllCalendars, type AllCalendars } from "../shared/api/calendar";
import type { AppError, Calendar } from "../shared/api/types";
import { holidayCalendar } from "../shared/lib/holidays";
import { feedCalendar } from "../shared/lib/feeds";
import { readJson, writeJson } from "../shared/lib/storage";
import { $activeAccounts, sessionLost, signOutFx } from "./auth";
import { $feeds, $holidayRegion } from "./display";


const VISIBILITY_KEY = "calm.calendarVisibility";

export const calendarToggled = createEvent<string>();
export const calendarsRequested = createEvent();

type CalendarsRequest = { accounts: string[]; id: number };

/** calendars of all accounts with valid sign-in */
export const fetchCalendarsFx = createEffect<CalendarsRequest, AllCalendars, AppError>(({ accounts }) =>
  listAllCalendars(accounts),
);

/** Number of the latest calendar request. A response to an older one is dropped: the account list changed since,
 *  or the person signed out while it was on the way */
export const $calendarsRequestId = createStore(0)
  .on(fetchCalendarsFx, (_, r) => r.id)
  .on(signOutFx, (id) => id + 1);

/** response to the latest request (stale ones are dropped) */
export const calendarsLoaded = sample({
  clock: fetchCalendarsFx.done,
  source: $calendarsRequestId,
  filter: (id, { params }) => params.id === id,
  fn: (_, { result }) => result,
});

/** failure of the latest request */
export const calendarsFailed = sample({
  clock: fetchCalendarsFx.fail,
  source: $calendarsRequestId,
  filter: (id, { params }) => params.id === id,
  fn: (_, { error }) => error,
});

const $googleCalendars = createStore<Calendar[]>([])
  .on(calendarsLoaded, (_, r) => r.calendars)
  .reset(signOutFx.finally);

const $holidayCalendar = combine($holidayRegion, $activeAccounts, $googleCalendars, holidayCalendar);

export const $calendars = combine($googleCalendars, $holidayCalendar, $feeds, (list, holiday, feeds) => [
  ...list,
  ...(holiday ? [holiday] : []),
  ...feeds.map(feedCalendar),
]);

/** accounts whose calendars failed to load right now */
export const $failedAccounts = createStore<string[]>([])
  .on(calendarsLoaded, (_, r) => r.failed)
  .reset(signOutFx.finally);

/** manual on/off toggles on top of Google settings */
export const $visibility = createStore<Record<string, boolean>>(readJson(VISIBILITY_KEY, {}));

sample({
  clock: calendarToggled,
  source: { visibility: $visibility, calendars: $calendars },
  fn: ({ visibility, calendars }, id) => {
    const calendar = calendars.find((c) => c.id === id);
    const current = calendar ? calendarVisible(calendar, visibility) : true;
    return { ...visibility, [id]: !current };
  },
  target: $visibility,
});

$visibility.updates.watch((v) => writeJson(VISIBILITY_KEY, v));

export const $calendarsWithVisibility = combine($calendars, $visibility, (calendars, visibility) =>
  calendars.map((c) => ({ ...c, visible: calendarVisible(c, visibility) })),
);

export const $visibleCalendars = $calendarsWithVisibility.map((list) => list.filter((c) => c.visible));

/** calendars where events can be written */
export const $writableCalendars = $calendars.map((list) =>
  list.filter((c) => c.accessRole === "owner" || c.accessRole === "writer"),
);

export const $calendarById = $calendars.map(
  (list) => new Map(list.map((c) => [c.id, c] as const)),
);

// a new account, sign-out or expired sign-in changes the account list — reload calendars
sample({
  clock: [$activeAccounts.updates, calendarsRequested],
  source: { accounts: $activeAccounts, id: $calendarsRequestId },
  filter: ({ accounts }) => accounts.length > 0,
  fn: ({ accounts, id }) => ({ accounts, id: id + 1 }),
  target: fetchCalendarsFx,
});

// Google stopped accepting sign-in for one of the accounts: ask Rust which one and show it
sample({
  clock: calendarsLoaded,
  filter: (r) => r.lost.length > 0,
  target: sessionLost,
});
