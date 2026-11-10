import { createEffect, createEvent, createStore, sample } from "effector";
import { searchEvents, sortByRelevance } from "../shared/api/calendar";
import type { AppError, Calendar, CalendarEvent } from "../shared/api/types";
import { $visibleCalendars } from "./calendars";
import { signOutFx } from "./auth";

const MIN_LENGTH = 2;
const MAX_RESULTS = 40;

export const queryChanged = createEvent<string>();
export const searchClosed = createEvent();
/** перевести фокус в строку поиска (из меню команд) */
export const searchFocusRequested = createEvent();
/** вызывается из строки поиска после паузы в наборе */
export const searchRequested = createEvent();

let lastId = 0;

export const searchFx = createEffect<
  { query: string; calendars: Calendar[]; id: number },
  { id: number; results: CalendarEvent[] },
  AppError
>(async ({ query, calendars, id }) => {
  const now = new Date();
  const settled = await Promise.allSettled(calendars.map((c) => searchEvents(c.id, query, now)));
  const found = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  return { id, results: sortByRelevance(found, now).slice(0, MAX_RESULTS) };
});

export const $query = createStore("")
  .on(queryChanged, (_, q) => q)
  .reset([searchClosed, signOutFx.finally]);

export const $results = createStore<CalendarEvent[] | null>(null)
  .on(searchFx.doneData, (state, r) => (r.id === lastId ? r.results : state))
  .on(queryChanged, (state, q) => (q.trim().length < MIN_LENGTH ? null : state))
  .reset([searchClosed, signOutFx.finally]);

export const $searching = searchFx.pending;

sample({
  clock: searchRequested,
  source: { query: $query, calendars: $visibleCalendars },
  filter: ({ query }) => query.trim().length >= MIN_LENGTH,
  fn: ({ query, calendars }) => ({ query: query.trim(), calendars, id: ++lastId }),
  target: searchFx,
});
