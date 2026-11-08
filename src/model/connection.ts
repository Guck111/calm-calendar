// Связь с Google: если данные показаны из сохранённых, интерфейс пишет, от какого они времени.
// Общая модель для главного окна и виджета.
import { createEvent, createStore } from "effector";
import { onConnectionChange } from "../shared/api/cache";
import { t } from "../shared/i18n";
import { formatShortDate, formatTime, isSameDay } from "../shared/lib/date";

export const connectionChanged = createEvent<number | null>();

/** время самых старых показанных сохранённых данных; null — всё свежее */
export const $offlineSince = createStore<number | null>(null).on(connectionChanged, (_, at) => at);

onConnectionChange(connectionChanged);

export const offlineText = (at: number, now = new Date()): string => {
  const d = new Date(at);
  return t.errors.offline(isSameDay(d, now) ? formatTime(d) : `${formatShortDate(d, now)}, ${formatTime(d)}`);
};

export const $offlineText = $offlineSince.map((at) => (at === null ? null : offlineText(at)));
