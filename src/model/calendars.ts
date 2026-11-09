import { combine, createEffect, createEvent, createStore, sample } from "effector";
import { calendarVisible, listAllCalendars, type AllCalendars } from "../shared/api/calendar";
import type { AppError, Calendar } from "../shared/api/types";
import { readJson, writeJson } from "../shared/lib/storage";
import { $activeAccounts, sessionLost, signOutFx } from "./auth";

const VISIBILITY_KEY = "calm.calendarVisibility";

export const calendarToggled = createEvent<string>();
export const calendarsRequested = createEvent();

/** календари всех аккаунтов с действующим входом */
export const fetchCalendarsFx = createEffect<string[], AllCalendars, AppError>(listAllCalendars);

export const $calendars = createStore<Calendar[]>([])
  .on(fetchCalendarsFx.doneData, (_, r) => r.calendars)
  .reset(signOutFx.finally);

/** аккаунты, чьи календари сейчас не загрузились */
export const $failedAccounts = createStore<string[]>([])
  .on(fetchCalendarsFx.doneData, (_, r) => r.failed)
  .reset(signOutFx.finally);

/** ручные включения и выключения поверх настроек Google */
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

/** календари, куда можно записывать события */
export const $writableCalendars = $calendars.map((list) =>
  list.filter((c) => c.accessRole === "owner" || c.accessRole === "writer"),
);

export const $calendarById = $calendars.map(
  (list) => new Map(list.map((c) => [c.id, c] as const)),
);

// новый аккаунт, выход из аккаунта или истёкший вход меняют список аккаунтов — перечитываем календари
sample({
  clock: [$activeAccounts.updates, calendarsRequested],
  source: $activeAccounts,
  filter: (accounts) => accounts.length > 0,
  target: fetchCalendarsFx,
});

// Google перестал принимать вход в один из аккаунтов: узнаём у Rust, какой это, и показываем
sample({
  clock: fetchCalendarsFx.doneData,
  filter: (r) => r.lost.length > 0,
  target: sessionLost,
});
