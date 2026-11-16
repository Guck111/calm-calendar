// «Отменить» после переноса и удаления. Перенос уже сохранён в Google: отмена сохраняет прежнее время.
// Удаление сначала только прячет событие на экране и уходит в Google, когда строка «Отменить» исчезла,
// пришло следующее действие или окно закрывается — так отмена не создаёт событие заново и не шлёт гостям писем
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

/** удаление одного события в одном календаре: ключ журнала, повтора и спрятанного на экране */
const keyOf = (c: Change) => deleteKey(c.draft.originalCalendarId ?? c.draft.calendarId, c.draft.id ?? "");

/** что спрятать на экране: одно событие или повторения серии с этого времени */
const hiddenFor = ({ draft, scope, event }: Change & { event: CalendarEvent }): Hidden => {
  const base = { key: deleteKey(event.calendarId, draft.id ?? event.id), calendarId: event.calendarId };
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
// пока перенос сохранялся, могли удалить другое событие: более новое действие важнее, строка «Удалено»
// остаётся (иначе удаление не ушло бы в Google, а событие осталось бы спрятанным)
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

// после отмены переноса список перечитывается: на экране то, что в Google; виджет и список у трея тоже
sample({ clock: restoreMoveFx.finally, target: reloadRequested });
restoreMoveFx.done.watch(() => broadcast("events-changed", { from: "main" }));
restoreMoveFx.failData.watch((e) => e.kind === "other" && logError("undo move failed", e));
sample({ clock: restoreMoveFx.failData, fn: (e) => t.errors.moveFailed(e.message), target: actionFailed });

// удаление дошло до Google или не дошло: спрятанное больше не прячем, список перечитается
sample({ clock: deleteFx.finally, fn: ({ params }) => keyOf(params), target: hidingEnded });

// --- удаление не теряется ---

// Журнал удалений на диске: удаление попадает в него, как только выбрано, и уходит из него, только когда
// Google ответил. Если приложение закроют раньше (Выход в трее закрывает сразу, а запрос «это и следующие»
// идёт в два шага), удаление уйдёт в Google после следующего входа в его аккаунт
const STORAGE_KEY = "calm.pendingDeletes";
export const persistDeleteFx = createEffect<Change[], void>((list) => writeJson(STORAGE_KEY, list));
const saved = readJson<Change[]>(STORAGE_KEY, []);
const journalOnDisk = Array.isArray(saved) ? saved : [];
/** удаления, которые ещё не подтвердил Google */
export const $deleteJournal = createStore<Change[]>(journalOnDisk);
/** удаления с прошлого запуска, которые ещё надо отправить: ждут входа в свой аккаунт */
export const $leftoverDeletes = createStore<Change[]>(journalOnDisk);

const accountOf = (c: Change) => splitRef(c.draft.originalCalendarId ?? c.draft.calendarId).account;

/** Google ответил окончательно: удалено, или удалять нечего (событие уже удалено, нет доступа) */
const settled = sample({
  clock: [
    deleteFx.done.map(({ params }) => params),
    deleteFx.fail.filter({
      fn: ({ error }) => !isTransient(error) && error.kind !== "not_signed_in" && error.kind !== "not_configured",
    }).map(({ params }) => params),
  ],
});
// не дошло (нет сети, вход истёк): удаление остаётся в журнале и попробует снова при следующем входе
const retryLater = deleteFx.fail.filter({
  fn: ({ error }) => isTransient(error) || error.kind === "not_signed_in" || error.kind === "not_configured",
});

$deleteJournal
  .on(deleteStarted, (list, { next }) => [...list.filter((c) => keyOf(c) !== keyOf((next as Deleted).change)), (next as Deleted).change])
  .on(undone, (list, p) => (p.kind === "deleted" ? list.filter((c) => keyOf(c) !== keyOf((p as Deleted).change)) : list))
  // ответ на старое удаление стирает только его, не более новое
  .on(settled, (list, change) => list.filter((c) => keyOf(c) !== keyOf(change)));
sample({ clock: $deleteJournal.updates, target: persistDeleteFx });

// повтор только того, что ещё в журнале: удаление, которое потом отменили, заменили новым или на которое
// Google уже ответил, из очереди повтора уходит
$leftoverDeletes
  .on(deleteStarted, (left, { next }) => left.filter((c) => keyOf(c) !== keyOf((next as Deleted).change)))
  .on(undone, (left, p) => (p.kind === "deleted" ? left.filter((c) => keyOf(c) !== keyOf((p as Deleted).change)) : left))
  .on(settled, (left, change) => left.filter((c) => keyOf(c) !== keyOf(change)));

// досылка: когда действует вход в аккаунт удаления (а не любой аккаунт)
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
// не дошло — ждёт следующего входа в свой аккаунт
sample({
  clock: retryLater,
  source: { left: $leftoverDeletes, journal: $deleteJournal },
  filter: ({ left, journal }, { params }) =>
    journal.some((c) => keyOf(c) === keyOf(params)) && !left.some((c) => keyOf(c) === keyOf(params)),
  fn: ({ left }, { params }) => [...left, params],
  target: $leftoverDeletes,
});

// Выход из аккаунта, пока видна строка «Удалено»: сначала удаление уходит в Google, потом выход
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
