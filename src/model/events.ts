import { combine, createEffect, createEvent, createStore, sample } from "effector";
import { t } from "../shared/i18n";
import { listEvents, occurrenceStart } from "../shared/api/calendar";
import { forgetFeeds } from "../shared/api/feeds";
import { toAppError } from "../shared/api/bridge";
import type { AppError, Calendar, CalendarEvent } from "../shared/api/types";
import type { DateRange } from "../shared/lib/date";
import { findConflicts, type Conflicts } from "../shared/lib/conflicts";
import { mergeSharedMeetings } from "../shared/lib/shared-meetings";
import { logError } from "../shared/lib/log";
import { $signedIn, sessionLost, signOutFx } from "./auth";
import { $failedAccounts, $visibleCalendars, calendarsFailed, calendarsRequested, fetchCalendarsFx } from "./calendars";
import { $range } from "./view";

/** reload calendars and events ("refresh" button, returning to the window) */
export const refreshRequested = createEvent();
/** reload events only (after save or delete) */
export const reloadRequested = createEvent();

type Request = { calendars: Calendar[]; range: DateRange; id: number };
/** lost — sign-in expired in some account, the others loaded */
type Result = { events: CalendarEvent[]; failed: string[]; lost: boolean; id: number };

export const fetchEventsFx = createEffect<Request, Result, AppError>(async ({ calendars, range, id }) => {
  const results = await Promise.allSettled(calendars.map((c) => listEvents(c.id, range)));
  const failed = calendars.filter((_, i) => results[i].status === "rejected").map((c) => c.name);
  const firstError = results.find((r) => r.status === "rejected");
  // if nothing loaded, it's a full error (offline, sign-in expired)
  if (calendars.length && failed.length === calendars.length && firstError?.status === "rejected") {
    throw toAppError(firstError.reason);
  }
  const lost = results.some((r) => r.status === "rejected" && toAppError(r.reason).kind === "not_signed_in");
  const all = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const writable = new Set(calendars.filter((c) => c.accessRole === "owner" || c.accessRole === "writer").map((c) => c.id));
  const events = mergeSharedMeetings(all, writable);
  return { events, failed, lost, id };
});

/** an action on an event failed — show it in the error bar */
export const actionFailed = createEvent<string>();

/** the event is already moved on screen, before Google responds */
export const eventShifted = createEvent<{ key: string; start: Date; end: Date }>();

/** Events deleted on screen but not yet in Google (while "Undo" is visible):
 *  a single event or series occurrences from this time on ("this and following") */
export type Hidden = { key: string; calendarId: string } & ({ id: string } | { recurringEventId: string; from: Date });

/** Deletion key: calendar and event id. The id alone isn't enough: an invitation has copies in calendars of different
 *  accounts with the same id */
export const deleteKey = (calendarId: string, id: string): string => `${calendarId}\u0000${id}`;

export const hides = (h: Hidden, e: CalendarEvent): boolean =>
  e.calendarId === h.calendarId &&
  ("id" in h ? e.id === h.id : e.recurringEventId === h.recurringEventId && occurrenceStart(e) >= h.from);

export const eventsHidden = createEvent<Hidden>();
/** "Undo": events return to the screen, no need to hide them anymore */
export const eventsRestored = createEvent<{ hidden: Hidden; events: CalendarEvent[] }>();
/** the deletion reached Google (or didn't): from now on take the list as is */
export const hidingEnded = createEvent<string>();

const $hidden = createStore<Hidden[]>([])
  .on(eventsHidden, (list, h) => [...list, h])
  .on(eventsRestored, (list, { hidden }) => list.filter((h) => h !== hidden))
  .on(hidingEnded, (list, key) => list.filter((h) => h.key !== key))
  .reset(signOutFx.finally);

/** Number of the latest event request. A response to an older one is not applied: the week was already paged
 *  further, or the person signed out while it was on the way */
export const $eventsRequestId = createStore(0)
  .on(fetchEventsFx, (_, r) => r.id)
  .on(signOutFx, (id) => id + 1);

/** response to the latest request */
export const eventsLoaded = sample({
  clock: fetchEventsFx.doneData,
  source: $eventsRequestId,
  filter: (id, r) => r.id === id,
  fn: (_, r) => r,
});

// hidden ones are not shown
const loaded = sample({
  clock: eventsLoaded,
  source: $hidden,
  fn: (hidden, r) => r.events.filter((e) => !hidden.some((h) => hides(h, e))),
});

export const $events = createStore<CalendarEvent[]>([])
  .on(eventShifted, (list, { key, start, end }) => list.map((e) => (e.key === key ? { ...e, start, end } : e)))
  .on(loaded, (_, events) => events)
  .on(eventsHidden, (list, h) => list.filter((e) => !hides(h, e)))
  .on(eventsRestored, (list, { events }) => [...list, ...events])
  .reset(signOutFx.finally);

/** overlaps of events from different accounts: event key → what it overlaps */
export const $conflicts = $events.map((list): Conflicts => findConflicts(list));

export const $loading = combine(fetchEventsFx.pending, fetchCalendarsFx.pending, (a, b) => a || b);

const $eventsError = createStore<string | null>(null)
  .on(eventsLoaded, (_, r) => (r.failed.length ? t.errors.calendarsFailed(r.failed.join(", ")) : null))
  .on(fetchEventsFx.failData, (_, e) => e.message)
  .on(calendarsFailed, (_, e) => e.message)
  .on(actionFailed, (_, m) => m)
  .reset(signOutFx.finally);

/** load error; if there is none but one of the accounts didn't respond, say which */
export const $loadError = combine($eventsError, $failedAccounts, (error, accounts) =>
  error ?? (accounts.length ? t.errors.accountsFailed(accounts.join(", ")) : null),
);

sample({
  clock: [$range.updates, $visibleCalendars.updates, reloadRequested],
  source: { signedIn: $signedIn, calendars: $visibleCalendars, range: $range, id: $eventsRequestId },
  filter: ({ signedIn }) => signedIn,
  fn: ({ calendars, range, id }) => ({ calendars, range, id: id + 1 }),
  target: fetchEventsFx,
});

// the new calendar list itself triggers event loading via $visibleCalendars
sample({ clock: refreshRequested, target: calendarsRequested });
// "Refresh" re-downloads .ics subscriptions too, without waiting for the cached copy to expire
refreshRequested.watch(forgetFeeds);

sample({
  clock: [fetchEventsFx.failData, calendarsFailed],
  filter: (e) => e.kind === "not_signed_in" || e.kind === "not_configured",
  target: sessionLost,
});

sample({ clock: eventsLoaded, filter: (r) => r.lost, target: sessionLost });

// failures of the UI itself (not Google responses — Rust logs those) go to the log
fetchEventsFx.failData.watch((e) => e.kind === "other" && logError("loading events failed", e));
fetchCalendarsFx.failData.watch((e) => e.kind === "other" && logError("loading calendars failed", e));
