// Connection to Google: time of the last successful load and retry when Google didn't respond.
// Retries — after 5 seconds, 15 seconds and a minute; after that the event is reloaded by the regular refresh every 5 minutes.
import { createEffect, createEvent, createStore, merge, sample } from "effector";
import type { AppError } from "../shared/api/types";
import { t } from "../shared/i18n";
import { formatShortDate, formatTime, isSameDay } from "../shared/lib/date";
import { fetchCalendarsFx } from "./calendars";
import { $offlineSince } from "./connection";
import { fetchEventsFx, refreshRequested } from "./events";

const DELAYS = [5_000, 15_000, 60_000];

/** delay before retry number attempt (zero-based); null — no more retries */
export const retryDelay = (attempt: number): number | null => DELAYS[attempt] ?? null;

/** a failure that passes by itself: offline, Google overloaded or temporarily unavailable */
export const isTransient = (e: AppError): boolean =>
  e.kind === "network" || (e.kind === "google" && [429, 500, 502, 503, 504].includes(e.status ?? 0));

/** "Retry" in the error bar */
export const retryClicked = createEvent();

export const retryFx = createEffect<number, void>((ms) => new Promise<void>((done) => setTimeout(done, ms)));

/** load succeeded: from Google, all calendars */
const loaded = sample({
  clock: fetchEventsFx.doneData,
  source: $offlineSince,
  filter: (offline, r) => offline === null && r.failed.length === 0,
  fn: () => Date.now(),
});

/** something failed to load or saved data is shown without network */
const trouble = merge([
  sample({ clock: [fetchEventsFx.failData, fetchCalendarsFx.failData], filter: isTransient }),
  sample({
    clock: fetchEventsFx.doneData,
    source: $offlineSince,
    filter: (offline, r) => offline !== null || r.failed.length > 0,
  }),
]);

/** how many retries in a row there have been */
const $attempt = createStore(0)
  .on(retryFx.done, (n) => n + 1)
  .reset([loaded, retryClicked]);

sample({
  clock: trouble,
  source: { attempt: $attempt, waiting: retryFx.pending },
  filter: ({ attempt, waiting }) => !waiting && retryDelay(attempt) !== null,
  fn: ({ attempt }) => retryDelay(attempt) as number,
  target: retryFx,
});

sample({ clock: [retryFx.done, retryClicked], target: refreshRequested });

/** a retry is waiting for its turn */
export const $retrying = retryFx.pending;

/** time of the last successful load from Google, ms; null — none yet */
export const $lastSynced = createStore<number | null>(null).on(loaded, (_, at) => at);

/** "Updated 10:42", for yesterday and earlier — with the date */
export const syncedText = (at: number, now = new Date()): string => {
  const d = new Date(at);
  return t.sync.updated(isSameDay(d, now) ? formatTime(d) : `${formatShortDate(d, now)}, ${formatTime(d)}`);
};
