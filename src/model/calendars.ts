import { combine, createEffect, createEvent, createStore, sample } from "effector";
import { listCalendars } from "../shared/api/calendar";
import type { AppError, Calendar } from "../shared/api/types";
import { readJson, writeJson } from "../shared/lib/storage";
import { $signedIn, signOutFx } from "./auth";

const VISIBILITY_KEY = "calm.calendarVisibility";

export const calendarToggled = createEvent<string>();
export const calendarsRequested = createEvent();

export const fetchCalendarsFx = createEffect<void, Calendar[], AppError>(listCalendars);

export const $calendars = createStore<Calendar[]>([])
  .on(fetchCalendarsFx.doneData, (_, list) => list)
  .reset(signOutFx.finally);

/** ручные включения и выключения поверх настроек Google */
export const $visibility = createStore<Record<string, boolean>>(readJson(VISIBILITY_KEY, {}));

sample({
  clock: calendarToggled,
  source: { visibility: $visibility, calendars: $calendars },
  fn: ({ visibility, calendars }, id) => {
    const current = visibility[id] ?? calendars.find((c) => c.id === id)?.selected ?? true;
    return { ...visibility, [id]: !current };
  },
  target: $visibility,
});

$visibility.updates.watch((v) => writeJson(VISIBILITY_KEY, v));

export const $calendarsWithVisibility = combine($calendars, $visibility, (calendars, visibility) =>
  calendars.map((c) => ({ ...c, visible: visibility[c.id] ?? c.selected })),
);

export const $visibleCalendars = $calendarsWithVisibility.map((list) => list.filter((c) => c.visible));

/** календари, куда можно записывать события */
export const $writableCalendars = $calendars.map((list) =>
  list.filter((c) => c.accessRole === "owner" || c.accessRole === "writer"),
);

export const $calendarById = $calendars.map(
  (list) => new Map(list.map((c) => [c.id, c] as const)),
);

sample({
  clock: [$signedIn.updates, calendarsRequested],
  source: $signedIn,
  filter: Boolean,
  target: fetchCalendarsFx,
});
