// Connection to Google: if data is shown from saved copies, the UI says how old it is.
// Shared model for the main window and the widget.
import { createEvent, createStore } from "effector";
import { onConnectionChange } from "../shared/api/cache";
import { t } from "../shared/i18n";
import { formatShortDate, formatTime, isSameDay } from "../shared/lib/date";

export const connectionChanged = createEvent<number | null>();

/** time of the oldest saved data shown; null — everything is fresh */
export const $offlineSince = createStore<number | null>(null).on(connectionChanged, (_, at) => at);

onConnectionChange(connectionChanged);

export const offlineText = (at: number, now = new Date()): string => {
  const d = new Date(at);
  return t.errors.offline(isSameDay(d, now) ? formatTime(d) : `${formatShortDate(d, now)}, ${formatTime(d)}`);
};

export const $offlineText = $offlineSince.map((at) => (at === null ? null : offlineText(at)));
