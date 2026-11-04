import { combine, createEffect, createEvent, createStore, sample } from "effector";
import { listEvents } from "../shared/api/calendar";
import { toAppError } from "../shared/api/bridge";
import type { AppError, Calendar, CalendarEvent } from "../shared/api/types";
import type { DateRange } from "../shared/lib/date";
import { $signedIn, sessionLost, signOutFx } from "./auth";
import { $visibleCalendars, calendarsRequested, fetchCalendarsFx } from "./calendars";
import { $range } from "./view";

/** перечитать календари и события (кнопка «обновить», возврат в окно) */
export const refreshRequested = createEvent();
/** перечитать только события (после сохранения или удаления) */
export const reloadRequested = createEvent();

type Request = { calendars: Calendar[]; range: DateRange; id: number };
type Result = { events: CalendarEvent[]; failed: string[]; id: number };

let lastRequestId = 0;

export const fetchEventsFx = createEffect<Request, Result, AppError>(async ({ calendars, range, id }) => {
  const results = await Promise.allSettled(calendars.map((c) => listEvents(c.id, range)));
  const failed = calendars.filter((_, i) => results[i].status === "rejected").map((c) => c.name);
  const firstError = results.find((r) => r.status === "rejected");
  // если не удалось ничего — это ошибка целиком (нет сети, вход истёк)
  if (calendars.length && failed.length === calendars.length && firstError?.status === "rejected") {
    throw toAppError(firstError.reason);
  }
  const events = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  return { events, failed, id };
});

export const $events = createStore<CalendarEvent[]>([])
  // ответ на устаревший запрос (уже перелистнули дальше) не применяем
  .on(fetchEventsFx.doneData, (state, r) => (r.id === lastRequestId ? r.events : state))
  .reset(signOutFx.finally);

export const $loading = combine(fetchEventsFx.pending, fetchCalendarsFx.pending, (a, b) => a || b);

export const $loadError = createStore<string | null>(null)
  .on(fetchEventsFx.doneData, (state, r) => {
    if (r.id !== lastRequestId) return state;
    return r.failed.length ? `Не загрузились календари: ${r.failed.join(", ")}` : null;
  })
  .on(fetchEventsFx.failData, (_, e) => e.message)
  .on(fetchCalendarsFx.failData, (_, e) => e.message)
  .reset(signOutFx.finally);

sample({
  clock: [$range.updates, $visibleCalendars.updates, reloadRequested],
  source: { signedIn: $signedIn, calendars: $visibleCalendars, range: $range },
  filter: ({ signedIn }) => signedIn,
  fn: ({ calendars, range }) => ({ calendars, range, id: ++lastRequestId }),
  target: fetchEventsFx,
});

// новый список календарей сам запустит загрузку событий через $visibleCalendars
sample({ clock: refreshRequested, target: calendarsRequested });

sample({
  clock: [fetchEventsFx.failData, fetchCalendarsFx.failData],
  filter: (e) => e.kind === "not_signed_in" || e.kind === "not_configured",
  target: sessionLost,
});
