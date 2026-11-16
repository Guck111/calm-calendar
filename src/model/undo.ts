// «Отменить» после переноса и удаления. Перенос уже сохранён в Google: отмена сохраняет прежнее время.
// Удаление сначала только прячет событие на экране и уходит в Google, когда строка «Отменить» исчезла,
// пришло следующее действие или окно закрывается — так отмена не создаёт событие заново и не шлёт гостям писем
import { createEffect, createEvent, createStore, sample } from "effector";
import { t } from "../shared/i18n";
import type { AppError, CalendarEvent, EventDraft, Scope } from "../shared/api/types";
import { $signOutHeld, $signedIn, signOutClicked, signOutFx, signOutResumed } from "./auth";
import { readJson, writeJson } from "../shared/lib/storage";
import { deleteFx, deleteRequested, eventMoved, fromEvent, moveFx } from "./editor";
import { occurrenceStart, saveEvent } from "../shared/api/calendar";
import { $visibility } from "./calendars";
import { logError } from "../shared/lib/log";
import { $events, actionFailed, eventShifted, reloadRequested, eventsHidden, eventsRestored, hidingEnded, hides, type Hidden } from "./events";

/** сколько видна строка «Отменить» */
export const UNDO_MS = 8000;
/** после того как мышь ушла со строки или фокус покинул её */
export const UNDO_RESUME_MS = 4000;

type Change = { draft: EventDraft; scope: Scope };

type Pending =
  | { kind: "deleted"; token: number; title: string; change: Change; hidden: Hidden; removed: CalendarEvent[] }
  | { kind: "moved"; token: number; title: string; event: CalendarEvent };
type Deleted = Extract<Pending, { kind: "deleted" }>;
type Moved = Extract<Pending, { kind: "moved" }>;

export const undoClicked = createEvent();
/** таймер строки истёк; token отличает таймер нынешней строки от прежних */
export const undoExpired = createEvent<number>();
/** мышь или фокус на строке: она не исчезает, пока человек с ней работает */
export const undoPaused = createEvent();
export const undoResumed = createEvent();
/** закрыть строку без отмены; удаление сразу уходит в Google */
export const undoDismissed = createEvent();

/** Отмена переноса: прежнее время сохраняется так же, как перенос, но новой строки «Отменить» не даёт */
export const restoreMoveFx = createEffect<{ event: CalendarEvent; start: Date; end: Date }, void, AppError>(
  ({ event, start, end }) => saveEvent(fromEvent({ ...event, start, end })),
);

/** ждёт ms и возвращает token своей строки */
export const undoTimerFx = createEffect<{ ms: number; token: number }, number>(
  ({ ms, token }) => new Promise<number>((done) => setTimeout(() => done(token), ms)),
);

const $token = createStore(0);
const $pending = createStore<Pending | null>(null);

/** строка «Отменить»: id меняется с каждым новым таймером */
export const $undo = $pending.map((p) => (p ? { id: p.token, kind: p.kind, title: p.title } : null));

const titleOf = (e: CalendarEvent) => e.title || t.common.untitled;

/** что спрятать на экране: одно событие или повторения серии с этого времени */
const hiddenFor = ({ draft, scope, event }: Change & { event: CalendarEvent }): Hidden => {
  const base = { draftId: draft.id ?? event.id, calendarId: event.calendarId };
  return scope === "following" && event.recurringEventId
    ? { ...base, recurringEventId: event.recurringEventId, from: occurrenceStart(event) }
    : { ...base, id: event.id };
};

// новое действие: прежнее удаление больше не отменить — отправляем его в Google сейчас
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

// новый перенос: прежнее удаление уходит в Google сразу. Строка «Отменить» появится, когда Google
// подтвердит перенос: иначе отмена ушла бы одновременно с ним и могла бы его обогнать
const movedOverDelete = sample({ clock: eventMoved, source: $pending, filter: (p) => p?.kind === "deleted" });
sample({ clock: movedOverDelete, target: committed });
$pending.reset(movedOverDelete);
const moveStarted = sample({
  clock: moveFx.done,
  source: $token,
  fn: (token, { params }): { prev: Pending | null; next: Pending } => ({
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

// время вышло или строку закрыли: удаление уходит в Google
const finished = sample({
  clock: [
    sample({ clock: undoTimerFx.doneData, source: $pending, filter: (p, token) => p?.token === token }),
    sample({ clock: undoExpired, source: $pending, filter: (p, token) => p?.token === token }),
    sample({ clock: undoDismissed, source: $pending }),
  ],
});
sample({ clock: finished, target: committed });
$pending.reset(finished);

// отмена удаления: событие возвращается на экран, в Google ничего не уходит
const undone = sample({ clock: undoClicked, source: $pending, filter: Boolean });
// календарь, который за это время скрыли, не показываем; список перечитывается — так вернутся и повторения,
// загруженные уже после удаления (другая неделя)
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
// отмена переноса: из нынешнего события меняется только время (и его пояс) — правки, сделанные
// после переноса (цвет, место), остаются
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

// пока с ней работают, строка не исчезает (новый token делает прежний таймер недействительным);
// потом ещё немного времени
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

// после отмены переноса список перечитывается: на экране то, что в Google
sample({ clock: restoreMoveFx.finally, target: reloadRequested });
restoreMoveFx.failData.watch((e) => e.kind === "other" && logError("undo move failed", e));
sample({ clock: restoreMoveFx.failData, fn: (e) => t.errors.moveFailed(e.message), target: actionFailed });

// удаление дошло до Google или не дошло: спрятанное больше не прячем, список перечитается
sample({ clock: deleteFx.finally, fn: ({ params }) => params.draft.id ?? "", target: hidingEnded });

// --- удаление не теряется ---

// Ожидающее удаление записано на диск: если приложение закроют (Выход в трее закрывает сразу, а страница
// не успевает ничего отправить), удаление уйдёт в Google при следующем входе
const STORAGE_KEY = "calm.pendingDelete";
export const persistDeleteFx = createEffect<Change | null, void>((change) => writeJson(STORAGE_KEY, change));
/** удаление, оставшееся с прошлого запуска */
export const $leftoverDelete = createStore<Change | null>(readJson<Change | null>(STORAGE_KEY, null));

sample({ clock: deleteStarted, fn: ({ next }) => (next as Deleted).change, target: persistDeleteFx });
sample({ clock: [undone, finished, movedOverDelete], fn: () => null, target: persistDeleteFx });

const leftoverSent = sample({
  clock: $signedIn.updates,
  source: $leftoverDelete,
  filter: (left, signedIn): left is Change => signedIn && left !== null,
});
sample({ clock: leftoverSent, target: deleteFx });
sample({ clock: leftoverSent, fn: () => null, target: persistDeleteFx });
$leftoverDelete.reset(leftoverSent);

// Выход из аккаунта, пока видна строка «Удалено»: сначала удаление уходит в Google, потом выход
$signOutHeld.on($pending, (_, p) => p?.kind === "deleted");
const $heldAccount = createStore<{ account: string | void; draftId: string } | null>(null);
const signOutWithDelete = sample({
  clock: signOutClicked,
  source: $pending,
  filter: (p) => p?.kind === "deleted",
  fn: (p, account) => ({ account, draftId: (p as Deleted).change.draft.id ?? "", pending: p }),
});
sample({ clock: signOutWithDelete, fn: ({ pending }) => pending, target: committed });
sample({ clock: signOutWithDelete, fn: () => null, target: persistDeleteFx });
$heldAccount.on(signOutWithDelete, (_, { account, draftId }) => ({ account, draftId }));
$pending.reset(signOutWithDelete);
const resumed = sample({
  clock: deleteFx.finally,
  source: $heldAccount,
  filter: (held, { params }): held is { account: string | void; draftId: string } =>
    held !== null && held.draftId === (params.draft.id ?? ""),
  fn: (held) => held?.account,
});
sample({ clock: resumed, target: signOutResumed });
$heldAccount.reset(resumed);

$pending.reset(signOutFx.finally);
