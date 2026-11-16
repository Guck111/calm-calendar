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

/** calendars of all accounts with valid sign-in */
export const fetchCalendarsFx = createEffect<string[], AllCalendars, AppError>(listAllCalendars);

const $googleCalendars = createStore<Calendar[]>([])
  .on(fetchCalendarsFx.doneData, (_, r) => r.calendars)
  .reset(signOutFx.finally);

const $holidayCalendar = combine($holidayRegion, $activeAccounts, $googleCalendars, holidayCalendar);

export const $calendars = combine($googleCalendars, $holidayCalendar, $feeds, (list, holiday, feeds) => [
  ...list,
  ...(holiday ? [holiday] : []),
  ...feeds.map(feedCalendar),
]);

/** accounts whose calendars failed to load right now */
export const $failedAccounts = createStore<string[]>([])
  .on(fetchCalendarsFx.doneData, (_, r) => r.failed)
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
  source: $activeAccounts,
  filter: (accounts) => accounts.length > 0,
  target: fetchCalendarsFx,
});

// Google stopped accepting sign-in for one of the accounts: ask Rust which one and show it
sample({
  clock: fetchCalendarsFx.doneData,
  filter: (r) => r.lost.length > 0,
  target: sessionLost,
});
