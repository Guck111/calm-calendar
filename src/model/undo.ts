// «Отменить» после переноса и удаления. Перенос уже сохранён в Google: отмена сохраняет прежнее время.
// Удаление сначала только прячет событие на экране и уходит в Google, когда строка «Отменить» исчезла,
// пришло следующее действие или окно закрывается — так отмена не создаёт событие заново и не шлёт гостям писем
import { createEffect, createEvent, createStore, sample } from "effector";
import { t } from "../shared/i18n";
import type { CalendarEvent, EventDraft, Scope } from "../shared/api/types";
import { signOutFx } from "./auth";
import { deleteFx, deleteRequested, eventMoved, moveFx } from "./editor";
import { $events, eventShifted, eventsHidden, eventsRestored, hidingEnded, hides, type Hidden } from "./events";

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
    ? { ...base, recurringEventId: event.recurringEventId, from: event.start }
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

const moveStarted = sample({
  clock: eventMoved,
  source: { prev: $pending, token: $token },
  fn: ({ prev, token }, { event }): { prev: Pending | null; next: Pending } => ({
    prev,
    next: { kind: "moved", token: token + 1, title: titleOf(event), event },
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
sample({
  clock: undone,
  filter: (p) => p.kind === "deleted",
  fn: (p) => ({ hidden: (p as Deleted).hidden, events: (p as Deleted).removed }),
  target: eventsRestored,
});
// отмена переноса: прежнее время сохраняется так же, как перенос, но новой строки «Отменить» не даёт
const restoredMove = sample({
  clock: undone,
  filter: (p) => p.kind === "moved",
  fn: (p) => ({ event: (p as Moved).event, start: (p as Moved).event.start, end: (p as Moved).event.end }),
});
sample({ clock: restoredMove, target: moveFx });
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

// перенос не удался: событие вернётся на место после перечитывания, отменять нечего
sample({
  clock: moveFx.fail,
  source: $pending,
  filter: (p, { params }) => p?.kind === "moved" && p.event.key === params.event.key,
  fn: () => null,
  target: $pending,
});

// удаление дошло до Google или не дошло: спрятанное больше не прячем, список перечитается
sample({ clock: deleteFx.finally, fn: ({ params }) => params.draft.id ?? "", target: hidingEnded });

$pending.reset(signOutFx.finally);
