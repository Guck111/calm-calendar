import { combine, createEffect, createEvent, createStore, sample } from "effector";
import { searchEvents, sortByRelevance } from "../shared/api/calendar";
import type { AppError, Calendar, CalendarEvent } from "../shared/api/types";
import { $visibleCalendars } from "./calendars";
import { signOutFx } from "./auth";

const MIN_LENGTH = 2;
const MAX_RESULTS = 40;

export const queryChanged = createEvent<string>();
export const searchClosed = createEvent();
/** move focus to the search input (from the command menu) */
export const searchFocusRequested = createEvent();
/** called from the search input after a pause in typing */
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

/** results of the latest search together with the text they were found for */
const $found = createStore<{ query: string; results: CalendarEvent[] } | null>(null)
  .on(searchFx.done, (state, { params, result }) =>
    result.id === lastId ? { query: params.query, results: result.results } : state,
  )
  .reset([searchClosed, signOutFx.finally]);

/** Results only for the text in the input now. While the next search waits for a pause in typing, the previous
 *  results are not shown under the new text, so Enter can't open an event from them */
export const $results = combine($found, $query, (found, query) =>
  found && query.trim().length >= MIN_LENGTH && found.query === query.trim() ? found.results : null,
);

export const $searching = searchFx.pending;

sample({
  clock: searchRequested,
  source: { query: $query, calendars: $visibleCalendars },
  filter: ({ query }) => query.trim().length >= MIN_LENGTH,
  fn: ({ query, calendars }) => ({ query: query.trim(), calendars, id: ++lastId }),
  target: searchFx,
});
