// Связь с Google: время последней удачной загрузки и повтор, когда Google не ответил.
// Повторы — через 5 секунд, 15 секунд и минуту; дальше событие перечитается обычным обновлением раз в 5 минут.
import { createEffect, createEvent, createStore, merge, sample } from "effector";
import type { AppError } from "../shared/api/types";
import { t } from "../shared/i18n";
import { formatShortDate, formatTime, isSameDay } from "../shared/lib/date";
import { fetchCalendarsFx } from "./calendars";
import { $offlineSince } from "./connection";
import { fetchEventsFx, refreshRequested } from "./events";

const DELAYS = [5_000, 15_000, 60_000];

/** пауза перед повтором номер attempt (с нуля); null — повторов больше не будет */
export const retryDelay = (attempt: number): number | null => DELAYS[attempt] ?? null;

/** сбой, который проходит сам: нет сети, Google перегружен или временно недоступен */
export const isTransient = (e: AppError): boolean =>
  e.kind === "network" || (e.kind === "google" && [429, 500, 502, 503, 504].includes(e.status ?? 0));

/** «Повторить» в полосе ошибки */
export const retryClicked = createEvent();

export const retryFx = createEffect<number, void>((ms) => new Promise<void>((done) => setTimeout(done, ms)));

/** загрузка прошла: из Google, все календари */
const loaded = sample({
  clock: fetchEventsFx.doneData,
  source: $offlineSince,
  filter: (offline, r) => offline === null && r.failed.length === 0,
  fn: () => Date.now(),
});

/** что-то не загрузилось или показаны сохранённые данные без сети */
const trouble = merge([
  sample({ clock: [fetchEventsFx.failData, fetchCalendarsFx.failData], filter: isTransient }),
  sample({
    clock: fetchEventsFx.doneData,
    source: $offlineSince,
    filter: (offline, r) => offline !== null || r.failed.length > 0,
  }),
]);

/** сколько повторов подряд уже было */
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

/** повтор ждёт своей очереди */
export const $retrying = retryFx.pending;

/** время последней удачной загрузки из Google, мс; null — ещё не было */
export const $lastSynced = createStore<number | null>(null).on(loaded, (_, at) => at);

/** «Обновлено 10:42», для вчерашнего и раньше — с датой */
export const syncedText = (at: number, now = new Date()): string => {
  const d = new Date(at);
  return t.sync.updated(isSameDay(d, now) ? formatTime(d) : `${formatShortDate(d, now)}, ${formatTime(d)}`);
};
