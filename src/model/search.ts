import { combine, createEffect, createEvent, createStore, sample } from "effector";
import { searchEvents, sortByRelevance } from "../shared/api/calendar";
import { toAppError } from "../shared/api/bridge";
import { t } from "../shared/i18n";
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
  /** failed — names of calendars that didn't answer: the results may be incomplete */
  { id: number; results: CalendarEvent[]; failed: string[] },
  AppError
>(async ({ query, calendars, id }) => {
  const now = new Date();
  const settled = await Promise.allSettled(calendars.map((c) => searchEvents(c.id, query, now)));
  const rejected = settled.find((r) => r.status === "rejected");
  // nothing answered (offline, sign-in expired): that's an error, not "nothing found"
  if (rejected?.status === "rejected" && settled.every((r) => r.status === "rejected")) throw toAppError(rejected.reason);
  const found = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const failed = calendars.filter((_, i) => settled[i].status === "rejected").map((c) => c.name);
  return { id, results: sortByRelevance(found, now).slice(0, MAX_RESULTS), failed };
});

export const $query = createStore("")
  .on(queryChanged, (_, q) => q)
  .reset([searchClosed, signOutFx.finally]);

/** Results of the latest search together with the text they were found for;
 *  problem — the search failed, or some calendars didn't answer */
const $found = createStore<{ query: string; results: CalendarEvent[]; problem: string | null } | null>(null)
  .on(searchFx.done, (state, { params, result }) =>
    result.id === lastId
      ? {
          query: params.query,
          results: result.results,
          problem: result.failed.length ? t.search.partial(result.failed.join(", ")) : null,
        }
      : state,
  )
  .on(searchFx.fail, (state, { params, error }) =>
    params.id === lastId ? { query: params.query, results: [], problem: t.search.failed(error.message) } : state,
  )
  .reset([searchClosed, signOutFx.finally]);

const $current = combine($found, $query, (found, query) =>
  found && query.trim().length >= MIN_LENGTH && found.query === query.trim() ? found : null,
);

/** Results only for the text in the input now. While the next search waits for a pause in typing, the previous
 *  results are not shown under the new text, so Enter can't open an event from them */
export const $results = $current.map((found) => found?.results ?? null);

/** why the results may be missing or incomplete; null — the search went through */
export const $searchProblem = $current.map((found) => found?.problem ?? null);

export const $searching = searchFx.pending;

sample({
  clock: searchRequested,
  source: { query: $query, calendars: $visibleCalendars },
  filter: ({ query }) => query.trim().length >= MIN_LENGTH,
  fn: ({ query, calendars }) => ({ query: query.trim(), calendars, id: ++lastId }),
  target: searchFx,
});
