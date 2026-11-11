import { combine, createEffect, createEvent, createStore, sample } from "effector";
import { t } from "../shared/i18n";
import { listEvents } from "../shared/api/calendar";
import { forgetFeeds } from "../shared/api/feeds";
import { toAppError } from "../shared/api/bridge";
import type { AppError, Calendar, CalendarEvent } from "../shared/api/types";
import type { DateRange } from "../shared/lib/date";
import { findConflicts, type Conflicts } from "../shared/lib/conflicts";
import { mergeSharedMeetings } from "../shared/lib/shared-meetings";
import { logError } from "../shared/lib/log";
import { $signedIn, sessionLost, signOutFx } from "./auth";
import { $failedAccounts, $visibleCalendars, calendarsRequested, fetchCalendarsFx } from "./calendars";
import { $range } from "./view";

/** перечитать календари и события (кнопка «обновить», возврат в окно) */
export const refreshRequested = createEvent();
/** перечитать только события (после сохранения или удаления) */
export const reloadRequested = createEvent();

type Request = { calendars: Calendar[]; range: DateRange; id: number };
/** lost — в каком-то аккаунте вход истёк, остальные загрузились */
type Result = { events: CalendarEvent[]; failed: string[]; lost: boolean; id: number };

let lastRequestId = 0;

export const fetchEventsFx = createEffect<Request, Result, AppError>(async ({ calendars, range, id }) => {
  const results = await Promise.allSettled(calendars.map((c) => listEvents(c.id, range)));
  const failed = calendars.filter((_, i) => results[i].status === "rejected").map((c) => c.name);
  const firstError = results.find((r) => r.status === "rejected");
  // если не удалось ничего — это ошибка целиком (нет сети, вход истёк)
  if (calendars.length && failed.length === calendars.length && firstError?.status === "rejected") {
    throw toAppError(firstError.reason);
  }
  const lost = results.some((r) => r.status === "rejected" && toAppError(r.reason).kind === "not_signed_in");
  const all = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const writable = new Set(calendars.filter((c) => c.accessRole === "owner" || c.accessRole === "writer").map((c) => c.id));
  const events = mergeSharedMeetings(all, writable);
  return { events, failed, lost, id };
});

/** действие с событием не удалось — показываем в полосе ошибок */
export const actionFailed = createEvent<string>();

/** событие уже передвинуто на экране, ещё до ответа Google */
export const eventShifted = createEvent<{ key: string; start: Date; end: Date }>();

export const $events = createStore<CalendarEvent[]>([])
  .on(eventShifted, (list, { key, start, end }) => list.map((e) => (e.key === key ? { ...e, start, end } : e)))
  // ответ на устаревший запрос (уже перелистнули дальше) не применяем
  .on(fetchEventsFx.doneData, (state, r) => (r.id === lastRequestId ? r.events : state))
  .reset(signOutFx.finally);

/** пересечения событий разных аккаунтов: ключ события → с чем пересекается */
export const $conflicts = $events.map((list): Conflicts => findConflicts(list));

export const $loading = combine(fetchEventsFx.pending, fetchCalendarsFx.pending, (a, b) => a || b);

const $eventsError = createStore<string | null>(null)
  .on(fetchEventsFx.doneData, (state, r) => {
    if (r.id !== lastRequestId) return state;
    return r.failed.length ? t.errors.calendarsFailed(r.failed.join(", ")) : null;
  })
  .on(fetchEventsFx.failData, (_, e) => e.message)
  .on(fetchCalendarsFx.failData, (_, e) => e.message)
  .on(actionFailed, (_, m) => m)
  .reset(signOutFx.finally);

/** ошибка загрузки; если её нет, но не ответил один из аккаунтов, — пишем какой */
export const $loadError = combine($eventsError, $failedAccounts, (error, accounts) =>
  error ?? (accounts.length ? t.errors.accountsFailed(accounts.join(", ")) : null),
);

sample({
  clock: [$range.updates, $visibleCalendars.updates, reloadRequested],
  source: { signedIn: $signedIn, calendars: $visibleCalendars, range: $range },
  filter: ({ signedIn }) => signedIn,
  fn: ({ calendars, range }) => ({ calendars, range, id: ++lastRequestId }),
  target: fetchEventsFx,
});

// новый список календарей сам запустит загрузку событий через $visibleCalendars
sample({ clock: refreshRequested, target: calendarsRequested });
// «Обновить» скачивает и подписки .ics заново, не дожидаясь, пока устареет запомненное
refreshRequested.watch(forgetFeeds);

sample({
  clock: [fetchEventsFx.failData, fetchCalendarsFx.failData],
  filter: (e) => e.kind === "not_signed_in" || e.kind === "not_configured",
  target: sessionLost,
});

sample({ clock: fetchEventsFx.doneData, filter: (r) => r.lost, target: sessionLost });

// сбои самого интерфейса (не ответы Google — их пишет Rust) — в журнал
fetchEventsFx.failData.watch((e) => e.kind === "other" && logError("loading events failed", e));
fetchCalendarsFx.failData.watch((e) => e.kind === "other" && logError("loading calendars failed", e));
