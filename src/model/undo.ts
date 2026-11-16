// "Undo" after move and delete. A move is already saved in Google: undo saves the previous time.
// A deletion first only hides the event on screen and goes to Google when the "Undo" bar has disappeared,
// the next action came or the window is closing — so undo doesn't recreate the event and doesn't email guests
import { createEffect, createEvent, createStore, sample } from "effector";
import { t } from "../shared/i18n";
import type { AppError, CalendarEvent, EventDraft, Scope } from "../shared/api/types";
import { $activeAccounts, $signOutHeld, signOutClicked, signOutFx, signOutResumed } from "./auth";
import { broadcast } from "../shared/api/bus";
import { isTransient } from "./sync";
import { readJson, writeJson } from "../shared/lib/storage";
import { deleteFx, deleteRequested, eventMoved, fromEvent, moveFx } from "./editor";
import { occurrenceStart, saveEvent, splitRef } from "../shared/api/calendar";
import { $visibility } from "./calendars";
import { logError } from "../shared/lib/log";
import { $events, actionFailed, eventShifted, reloadRequested, deleteKey, eventsHidden, eventsRestored, hidingEnded, hides, type Hidden } from "./events";

/** how long the "Undo" bar is visible */
export const UNDO_MS = 8000;
/** after the mouse left the bar or focus left it */
export const UNDO_RESUME_MS = 4000;

type Change = { draft: EventDraft; scope: Scope };

type Pending =
  | { kind: "deleted"; token: number; title: string; change: Change; hidden: Hidden; removed: CalendarEvent[] }
  | { kind: "moved"; token: number; title: string; event: CalendarEvent };
type Deleted = Extract<Pending, { kind: "deleted" }>;
type Moved = Extract<Pending, { kind: "moved" }>;

export const undoClicked = createEvent();
/** the bar's timer expired; token tells the current bar's timer from previous ones */
export const undoExpired = createEvent<number>();
/** mouse or focus on the bar: it doesn't disappear while the person works with it */
export const undoPaused = createEvent();
export const undoResumed = createEvent();
/** close the bar without undoing; the deletion goes to Google right away */
export const undoDismissed = createEvent();

/** Undo move: the previous time is saved the same way as a move, but gives no new "Undo" bar */
export const restoreMoveFx = createEffect<{ event: CalendarEvent; start: Date; end: Date }, void, AppError>(
  ({ event, start, end }) => saveEvent(fromEvent({ ...event, start, end })),
);

/** waits ms and returns its bar's token */
export const undoTimerFx = createEffect<{ ms: number; token: number }, number>(
  ({ ms, token }) => new Promise<number>((done) => setTimeout(() => done(token), ms)),
);

const $token = createStore(0);
const $pending = createStore<Pending | null>(null);

/** "Undo" bar: id changes with each new timer */
export const $undo = $pending.map((p) => (p ? { id: p.token, kind: p.kind, title: p.title } : null));

const titleOf = (e: CalendarEvent) => e.title || t.common.untitled;

/** deletion of one event in one calendar: key for the log, retry and hidden-on-screen */
const keyOf = (c: Change) => deleteKey(c.draft.originalCalendarId ?? c.draft.calendarId, c.draft.id ?? "");

/** what to hide on screen: a single event or series occurrences from this time on */
const hiddenFor = ({ draft, scope, event }: Change & { event: CalendarEvent }): Hidden => {
  const base = { key: deleteKey(event.calendarId, draft.id ?? event.id), calendarId: event.calendarId };
  return scope === "following" && event.recurringEventId
    ? { ...base, recurringEventId: event.recurringEventId, from: occurrenceStart(event) }
    : { ...base, id: event.id };
};

// new action: the previous deletion can no longer be undone — send it to Google now
const committed = createEvent<Pending | null>();
sample({
  clock: committed,
  filter: (p: Pending | null) => p?.kind === "deleted",
  fn: (p) => (p as Deleted).change,
  target: deleteFx,
});

const deleteStarted = sample({
  clock: deleteRequested,
  source: { prev: $pending, events: $events, token: $token },
  fn: ({ prev, events, token }, request): { prev: Pending | null; next: Pending } => {
    const hidden = hiddenFor(request);
    return {
      prev,
      next: {
        kind: "deleted",
        token: token + 1,
        title: titleOf(request.event),
        change: { draft: request.draft, scope: request.scope },
        hidden,
        removed: events.filter((e) => hides(hidden, e)),
      },
    };
  },
});

// new move: the previous deletion goes to Google right away. The "Undo" bar appears when Google
// confirms the move: otherwise the undo would go out together with it and could overtake it
const movedOverDelete = sample({ clock: eventMoved, source: $pending, filter: (p) => p?.kind === "deleted" });
sample({ clock: movedOverDelete, target: committed });
$pending.reset(movedOverDelete);
// while the move was being saved, another event could have been deleted: the newer action wins, the "Deleted" bar
// stays (otherwise the deletion wouldn't reach Google and the event would stay hidden)
const moveStarted = sample({
  clock: moveFx.done,
  source: { token: $token, pending: $pending },
  filter: ({ pending }) => pending?.kind !== "deleted",
  fn: ({ token }, { params }): { prev: Pending | null; next: Pending } => ({
    prev: null,
    next: { kind: "moved", token: token + 1, title: titleOf(params.event), event: params.event },
  }),
});

const started = sample({ clock: [deleteStarted, moveStarted] });
sample({ clock: started, fn: ({ prev }) => prev, target: committed });
$pending.on(started, (_, { next }) => next);
$token.on(started, (n) => n + 1);
sample({
  clock: deleteStarted,
  fn: ({ next }) => (next as Deleted).hidden,
  target: eventsHidden,
});
sample({ clock: started, fn: ({ next }) => ({ ms: UNDO_MS, token: next.token }), target: undoTimerFx });

// time ran out or the bar was closed: the deletion goes to Google
const finished = sample({
  clock: [
    sample({ clock: undoTimerFx.doneData, source: $pending, filter: (p, token) => p?.token === token }),
    sample({ clock: undoExpired, source: $pending, filter: (p, token) => p?.token === token }),
    sample({ clock: undoDismissed, source: $pending }),
  ],
});
sample({ clock: finished, target: committed });
$pending.reset(finished);

// undo delete: the event returns to the screen, nothing goes to Google
const undone = sample({ clock: undoClicked, source: $pending, filter: Boolean });
// a calendar hidden meanwhile is not shown; the list is reloaded — that also brings back occurrences
// loaded after the deletion (another week)
sample({
  clock: undone,
  source: $visibility,
  filter: (_, p) => p.kind === "deleted",
  fn: (visibility, p) => ({
    hidden: (p as Deleted).hidden,
    events: (p as Deleted).removed.filter((e) => visibility[e.calendarId] !== false),
  }),
  target: eventsRestored,
});
sample({ clock: undone, filter: (p) => p.kind === "deleted", target: reloadRequested });
// undo move: of the current event only the time (and its time zone) changes — edits made
// after the move (color, place) stay
const restoredMove = sample({
  clock: undone,
  source: $events,
  filter: (_, p) => p.kind === "moved",
  fn: (events, p) => {
    const before = (p as Moved).event;
    const now = events.find((e) => e.key === before.key) ?? before;
    const event: CalendarEvent = { ...now, timeZone: before.timeZone, endTimeZone: before.endTimeZone };
    return { event, start: before.start, end: before.end };
  },
});
sample({ clock: restoredMove, target: restoreMoveFx });
sample({ clock: restoredMove, fn: ({ event, start, end }) => ({ key: event.key, start, end }), target: eventShifted });
$pending.reset(undone);

// while it is being used, the bar doesn't disappear (a new token invalidates the previous timer);
// then a little more time
sample({
  clock: undoPaused,
  source: { p: $pending, token: $token },
  filter: ({ p }) => Boolean(p),
  fn: ({ p, token }) => ({ ...(p as Pending), token: token + 1 }),
  target: $pending,
});
$token.on(undoPaused, (n) => n + 1);
sample({
  clock: undoResumed,
  source: $pending,
  filter: Boolean,
  fn: (p) => ({ ms: UNDO_RESUME_MS, token: p.token }),
  target: undoTimerFx,
});

// after undoing a move the list is reloaded: the screen shows what is in Google; the widget and tray agenda too
sample({ clock: restoreMoveFx.finally, target: reloadRequested });
restoreMoveFx.done.watch(() => broadcast("events-changed", { from: "main" }));
restoreMoveFx.failData.watch((e) => e.kind === "other" && logError("undo move failed", e));
sample({ clock: restoreMoveFx.failData, fn: (e) => t.errors.moveFailed(e.message), target: actionFailed });

// the deletion reached Google or didn't: stop hiding the hidden ones, the list will be reloaded
sample({ clock: deleteFx.finally, fn: ({ params }) => keyOf(params), target: hidingEnded });

// --- deletion is not lost ---

// Deletion log on disk: a deletion goes into it as soon as it is chosen and leaves it only when
// Google has responded. If the app is closed earlier (Quit in the tray closes immediately, and the "this and following" request
// takes two steps), the deletion goes to Google after the next sign-in to its account
const STORAGE_KEY = "calm.pendingDeletes";
export const persistDeleteFx = createEffect<Change[], void>((list) => writeJson(STORAGE_KEY, list));
const saved = readJson<Change[]>(STORAGE_KEY, []);
const journalOnDisk = Array.isArray(saved) ? saved : [];
/** deletions not yet confirmed by Google */
export const $deleteJournal = createStore<Change[]>(journalOnDisk);
/** deletions from the previous run that still need to be sent: they wait for a sign-in to their account */
export const $leftoverDeletes = createStore<Change[]>(journalOnDisk);

const accountOf = (c: Change) => splitRef(c.draft.originalCalendarId ?? c.draft.calendarId).account;

/** Google gave a final answer: deleted, or nothing to delete (event already deleted, no access) */
const settled = sample({
  clock: [
    deleteFx.done.map(({ params }) => params),
    deleteFx.fail.filter({
      fn: ({ error }) => !isTransient(error) && error.kind !== "not_signed_in" && error.kind !== "not_configured",
    }).map(({ params }) => params),
  ],
});
// didn't go through (offline, sign-in expired): the deletion stays in the log and tries again on the next sign-in
const retryLater = deleteFx.fail.filter({
  fn: ({ error }) => isTransient(error) || error.kind === "not_signed_in" || error.kind === "not_configured",
});

$deleteJournal
  .on(deleteStarted, (list, { next }) => [...list.filter((c) => keyOf(c) !== keyOf((next as Deleted).change)), (next as Deleted).change])
  .on(undone, (list, p) => (p.kind === "deleted" ? list.filter((c) => keyOf(c) !== keyOf((p as Deleted).change)) : list))
  // a response to an old deletion erases only that one, not a newer one
  .on(settled, (list, change) => list.filter((c) => keyOf(c) !== keyOf(change)));
sample({ clock: $deleteJournal.updates, target: persistDeleteFx });

// retry only what is still in the log: a deletion that was later undone, replaced by a new one, or that
// Google has already answered leaves the retry queue
$leftoverDeletes
  .on(deleteStarted, (left, { next }) => left.filter((c) => keyOf(c) !== keyOf((next as Deleted).change)))
  .on(undone, (left, p) => (p.kind === "deleted" ? left.filter((c) => keyOf(c) !== keyOf((p as Deleted).change)) : left))
  .on(settled, (left, change) => left.filter((c) => keyOf(c) !== keyOf(change)));

// resend: when the sign-in to the deletion's account is valid (not just any account)
const leftoverDue = sample({
  clock: $activeAccounts.updates,
  source: { left: $leftoverDeletes, journal: $deleteJournal },
  fn: ({ left, journal }, active) =>
    left.filter((c) => active.includes(accountOf(c)) && journal.some((j) => keyOf(j) === keyOf(c))),
}).filter({ fn: (due) => due.length > 0 });
$leftoverDeletes.on(leftoverDue, (left, due) => left.filter((c) => !due.includes(c)));
const replayFx = createEffect<Change[], void>(async (due) => {
  await Promise.allSettled(due.map((c) => deleteFx(c)));
});
sample({ clock: leftoverDue, target: replayFx });
// didn't go through — waits for the next sign-in to its account
sample({
  clock: retryLater,
  source: { left: $leftoverDeletes, journal: $deleteJournal },
  filter: ({ left, journal }, { params }) =>
    journal.some((c) => keyOf(c) === keyOf(params)) && !left.some((c) => keyOf(c) === keyOf(params)),
  fn: ({ left }, { params }) => [...left, params],
  target: $leftoverDeletes,
});

// Signing out of an account while the "Deleted" bar is visible: first the deletion goes to Google, then the sign-out
$signOutHeld.on($pending, (_, p) => p?.kind === "deleted");
const $heldAccount = createStore<{ account: string | void; key: string } | null>(null);
const signOutWithDelete = sample({
  clock: signOutClicked,
  source: $pending,
  filter: (p) => p?.kind === "deleted",
  fn: (p, account) => ({ account, key: keyOf((p as Deleted).change), pending: p }),
});
sample({ clock: signOutWithDelete, fn: ({ pending }) => pending, target: committed });
$heldAccount.on(signOutWithDelete, (_, { account, key }) => ({ account, key }));
$pending.reset(signOutWithDelete);
const resumed = sample({
  clock: deleteFx.finally,
  source: $heldAccount,
  filter: (held, { params }): held is { account: string | void; key: string } =>
    held !== null && held.key === keyOf(params),
  fn: (held) => held?.account,
});
sample({ clock: resumed, target: signOutResumed });
$heldAccount.reset(resumed);

$pending.reset(signOutFx.finally);
