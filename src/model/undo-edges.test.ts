// "Undo" edge cases: timers, the bar's token, undoing a move, the deletion log and sign-out during a deletion
import { allSettled, createWatch, fork, scopeBind, type Scope as EffectorScope } from "effector";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../shared/api/calendar";
import { broadcast } from "../shared/api/bus";
import type { AppError, CalendarEvent, EventDraft, Scope } from "../shared/api/types";
import { t } from "../shared/i18n";
import { logError } from "../shared/lib/log";
import { fetchStatusFx, signOutClicked, signOutFx, signOutResumed } from "./auth";
import { deleteFx, deleteRequested, eventMoved, fromEvent, moveFx } from "./editor";
import { $events, $loadError, actionFailed, fetchEventsFx, reloadRequested } from "./events";
import { $deleteJournal, $leftoverDeletes, $undo, persistDeleteFx, restoreMoveFx, undoClicked, undoPaused, undoResumed, undoTimerFx } from "./undo";

vi.mock("../shared/api/calendar", async (original) => ({
  ...(await original<typeof import("../shared/api/calendar")>()),
  moveEvent: vi.fn(async () => undefined),
}));
vi.mock("../shared/api/bus", async (original) => ({ ...(await original<typeof import("../shared/api/bus")>()), broadcast: vi.fn() }));
vi.mock("../shared/lib/log", async (original) => ({ ...(await original<typeof import("../shared/lib/log")>()), logError: vi.fn() }));
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

type Change = { draft: EventDraft; scope: Scope };
const CAL = "me@example.com\u0000primary";
const event = (id: string, h: number): CalendarEvent => ({
  key: `${CAL}\u0000${id}`, id, calendarId: CAL, account: "me@example.com", title: id,
  start: new Date(2026, 10, 11, h), end: new Date(2026, 10, 11, h + 1), allDay: false, recurring: false,
});
const dentist = event("dentist", 16);
const lunch = event("lunch", 13);
const change = (e: CalendarEvent): Change => ({ draft: { ...fromEvent(e), id: e.id, originalCalendarId: e.calendarId }, scope: "this" });
const request = (e: CalendarEvent) => ({ ...change(e), event: e });
const watch = (scope: EffectorScope, unit: Parameters<typeof createWatch>[0]["unit"]) => {
  const fn = vi.fn();
  createWatch({ unit, fn, scope });
  return fn;
};

describe("real undo effects", () => {
  it("the bar's timer answers with its token after the given time", async () => {
    vi.useFakeTimers();
    const done = allSettled(undoTimerFx, { scope: fork(), params: { ms: 8000, token: 3 } });
    await vi.advanceTimersByTimeAsync(8000);
    expect(await done).toEqual({ status: "done", value: 3 });
  });

  it("undoing a move saves the event with its previous time", async () => {
    const start = new Date(2026, 10, 11, 9);
    const end = new Date(2026, 10, 11, 10);
    await allSettled(restoreMoveFx, { scope: fork(), params: { event: dentist, start, end } });
    expect(vi.mocked(api.moveEvent)).toHaveBeenCalledWith({ ...fromEvent({ ...dentist, start, end }), id: "dentist" });
  });
});

/** timers that end when the test says so, by token */
const manualTimers = () => {
  const waiting = new Map<number, () => void>();
  const handler = ({ token }: { token: number }) => new Promise<number>((done) => waiting.set(token, () => done(token)));
  return { handler, end: (token: number) => waiting.get(token)?.(), tokens: () => [...waiting.keys()] };
};

describe("the bar's timer", () => {
  it("the deletion goes to Google when the current bar's timer ends, not a paused one's", async () => {
    const timers = manualTimers();
    const deleted: Change[] = [];
    const scope = fork({
      values: [[$events, [dentist, lunch]]],
      handlers: [[undoTimerFx, timers.handler], [deleteFx, (c: Change) => void deleted.push(c)], [persistDeleteFx, () => undefined]],
    });
    scopeBind(deleteRequested, { scope })(request(dentist));
    const [first] = timers.tokens();
    scopeBind(undoPaused, { scope })();
    scopeBind(undoResumed, { scope })();
    timers.end(first);
    await new Promise((done) => setTimeout(done, 0));
    expect(deleted).toEqual([]);
    const resumed = timers.tokens().at(-1) as number;
    expect(resumed).not.toBe(first);
    timers.end(resumed);
    await allSettled(scope);
    expect(deleted.map((c) => c.draft.id)).toEqual(["dentist"]);
    expect(scope.getState($undo)).toBeNull();
  });
});

describe("undoing a move", () => {
  const setup = (fail?: AppError) => {
    const restored: { event: CalendarEvent }[] = [];
    const deleted: Change[] = [];
    const scope = fork({
      values: [[$events, [lunch, dentist]]],
      handlers: [
        [moveFx, async () => undefined],
        [restoreMoveFx, (r: { event: CalendarEvent }) => (restored.push(r), fail ? Promise.reject(fail) : undefined)],
        [deleteFx, (c: Change) => void deleted.push(c)],
        [undoTimerFx, () => -1],
        [fetchEventsFx, async ({ id }: { id: number }) => ({ events: [], failed: [], lost: false, id })],
        [signOutFx, async () => undefined],
      ],
    });
    const move =(e: CalendarEvent) => allSettled(moveFx, { scope, params: { event: e, start: new Date(2026, 10, 12, 9), end: new Date(2026, 10, 12, 10) } });
    return { scope, restored, deleted, move };
  };

  it("restores the moved event, not another one, reloads once and tells the other windows", async () => {
    const { scope, restored, move } = setup();
    await move(dentist);
    const reloads = watch(scope, reloadRequested);
    vi.mocked(broadcast).mockClear();
    await allSettled(undoClicked, { scope });
    expect(restored.map((r) => r.event.key)).toEqual([dentist.key]);
    expect(reloads).toHaveBeenCalledTimes(1);
    expect(vi.mocked(broadcast)).toHaveBeenCalledWith("events-changed", { from: "main" });
  });

  it("a move over another move's bar sends no deletion", async () => {
    const { scope, deleted, move } = setup();
    await move(dentist);
    await allSettled(eventMoved, { scope, params: { event: lunch, start: new Date(2026, 10, 12, 9), end: new Date(2026, 10, 12, 10) } });
    await move(lunch);
    expect(deleted).toEqual([]);
  });

  it("a failed undo is reported, and logged when it is a failure of the app itself", async () => {
    const { scope, move } = setup({ kind: "other", message: "bug" });
    await move(dentist);
    await allSettled(undoClicked, { scope });
    expect(scope.getState($loadError)).toBe(t.errors.moveFailed("bug"));
    expect(vi.mocked(logError)).toHaveBeenCalledWith("undo move failed", { kind: "other", message: "bug" });
  });

  it("a network failure of the undo is reported but not logged", async () => {
    const { scope, move } = setup({ kind: "network", message: "offline" });
    await move(dentist);
    await allSettled(undoClicked, { scope });
    expect(vi.mocked(logError)).not.toHaveBeenCalled();
  });

  it("sign-out closes a move's bar", async () => {
    const { scope, move } = setup();
    await move(dentist);
    expect(scope.getState($undo)).toMatchObject({ kind: "moved" });
    await allSettled(signOutFx, { scope, params: undefined });
    expect(scope.getState($undo)).toBeNull();
  });
});

describe("deletion log edge cases", () => {
  const scopeWith = (values: { left?: Change[]; journal?: Change[] } = {}, deleteHandler: (c: Change) => unknown = () => undefined) =>
    fork({
      values: [[$events, [dentist, lunch]], [$leftoverDeletes, values.left ?? []], [$deleteJournal, values.journal ?? []]],
      handlers: [[deleteFx, deleteHandler], [persistDeleteFx, () => undefined], [undoTimerFx, () => -1],
        // an expired sign-in makes the app re-read who is signed in: nobody, so nothing is resent in a loop
        [fetchStatusFx, async () => ({ clientSource: "file" as const, accounts: [] })], [fetchEventsFx, async ({ id }: { id: number }) => ({ events: [dentist], failed: [], lost: false, id })]],
    });
  const ids = (list: Change[]) => list.map((c) => c.draft.id);

  it("deleting the same event again keeps one entry in the log", async () => {
    const scope = scopeWith({}, () => Promise.reject({ kind: "network", message: "offline" }));
    await allSettled(deleteRequested, { scope, params: request(dentist) });
    await allSettled(undoClicked, { scope });
    await allSettled(deleteRequested, { scope, params: request(dentist) });
    await allSettled(deleteRequested, { scope, params: request(dentist) });
    expect(ids(scope.getState($deleteJournal))).toEqual(["dentist"]);
  });

  it("a leftover deletion leaves the retry queue when deleted anew, undone or answered by Google", async () => {
    const scope = scopeWith({ left: [change(dentist), change(lunch)], journal: [change(dentist), change(lunch)] });
    await allSettled(deleteRequested, { scope, params: request(dentist) });
    expect(ids(scope.getState($leftoverDeletes))).toEqual(["lunch"]);
    const undoScope = scopeWith({ left: [change(dentist)], journal: [change(dentist)] });
    await allSettled(deleteRequested, { scope: undoScope, params: request(lunch) });
    await allSettled(undoClicked, { scope: undoScope });
    expect(ids(undoScope.getState($leftoverDeletes))).toEqual(["dentist"]);
    const settledScope = scopeWith({ left: [change(dentist), change(lunch)], journal: [change(dentist), change(lunch)] });
    await allSettled(deleteFx, { scope: settledScope, params: change(lunch) });
    expect(ids(settledScope.getState($leftoverDeletes))).toEqual(["dentist"]);
  });

  it("only deletions still in the log are resent at sign-in, and a failure re-queues only those", async () => {
    const resend = async (left: Change[], journal: Change[]) => {
      const deleted: Change[] = [];
      const scope = fork({
        values: [[$leftoverDeletes, left], [$deleteJournal, journal]],
        handlers: [[deleteFx, (c: Change) => void deleted.push(c)], [persistDeleteFx, () => undefined],
          [fetchStatusFx, async () => ({ clientSource: "file" as const, accounts: [{ email: "me@example.com", signedIn: true }] })]],
      });
      await allSettled(fetchStatusFx, { scope });
      return ids(deleted);
    };
    expect(await resend([change(dentist)], [change(dentist), change(lunch)])).toEqual(["dentist"]);
    expect(await resend([change(dentist)], [change(lunch)])).toEqual([]);
    const scope = scopeWith({}, () => Promise.reject({ kind: "network", message: "offline" }));
    await allSettled(deleteFx, { scope, params: change(lunch) });
    expect(scope.getState($leftoverDeletes)).toEqual([]);
  });

  it("an expired sign-in or a missing client keeps the deletion for later, once", async () => {
    for (const kind of ["not_signed_in", "not_configured"] as const) {
      const scope = scopeWith({ journal: [change(dentist)] }, () => Promise.reject({ kind, message: kind }));
      await allSettled(deleteFx, { scope, params: change(dentist) });
      await allSettled(deleteFx, { scope, params: change(dentist) });
      expect(ids(scope.getState($deleteJournal))).toEqual(["dentist"]);
      expect(ids(scope.getState($leftoverDeletes))).toEqual(["dentist"]);
    }
  });

  it("when the deletion reached Google, the event isn't hidden anymore", async () => {
    const scope = scopeWith({}, () => Promise.reject({ kind: "google", message: "403: Forbidden", status: 403 }));
    await allSettled(deleteRequested, { scope, params: request(dentist) });
    await allSettled(deleteFx, { scope, params: change(dentist) });
    await allSettled(fetchEventsFx, { scope, params: { calendars: [], range: { start: new Date(), end: new Date() }, id: 1 } });
    expect(scope.getState($events).map((e) => e.id)).toEqual(["dentist"]);
  });

  it("an empty log that can't be written is not reported, a log with a deletion is, and the failure is logged", async () => {
    const failed = vi.fn();
    const scope = fork({
      values: [[$events, [dentist]]],
      handlers: [[persistDeleteFx, () => Promise.reject(new Error("quota"))], [undoTimerFx, () => -1], [deleteFx, () => undefined]],
    });
    createWatch({ unit: persistDeleteFx.fail, fn: ({ params }) => failed(params.length), scope });
    const reported = watch(scope, actionFailed);
    await allSettled(deleteRequested, { scope, params: request(dentist) });
    expect(scope.getState($loadError)).toBe(t.errors.deleteNotSaved);
    await allSettled(undoClicked, { scope });
    expect(failed.mock.calls.map(([n]) => n)).toEqual([1, 0]);
    expect(reported).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logError)).toHaveBeenCalledWith("saving the deletion log failed", expect.any(Error));
  });
});

describe("sign-out during a deletion", () => {
  it("with only a move to undo, sign-out happens right away", async () => {
    const signedOut = vi.fn(async () => undefined);
    const scope = fork({ values: [[$events, [dentist]]], handlers: [[moveFx, async () => undefined], [undoTimerFx, () => -1], [signOutFx, signedOut]] });
    await allSettled(moveFx, { scope, params: { event: dentist, start: new Date(2026, 10, 12, 9), end: new Date(2026, 10, 12, 10) } });
    await allSettled(signOutClicked, { scope, params: "me@example.com" });
    expect(signedOut).toHaveBeenCalledWith("me@example.com");
  });

  it("resumes only after its own deletion, once, and closes the bar", async () => {
    let finish!: () => void;
    const resumed = vi.fn();
    const scope = fork({
      values: [[$events, [dentist, lunch]]],
      handlers: [
        [deleteFx, (c: Change) => (c.draft.id === "dentist" ? new Promise<void>((done) => (finish = done)) : undefined)],
        [persistDeleteFx, () => undefined],
        [undoTimerFx, () => -1],
        [signOutFx, async () => undefined],
      ],
    });
    createWatch({ unit: signOutResumed, fn: resumed, scope });
    await allSettled(deleteRequested, { scope, params: request(dentist) });
    const signOut = allSettled(signOutClicked, { scope, params: "me@example.com" });
    await Promise.resolve();
    expect(scope.getState($undo)).toBeNull();
    const remove = scopeBind(deleteFx, { scope });
    await remove(change(lunch));
    expect(resumed).not.toHaveBeenCalled();
    finish();
    await signOut;
    expect(resumed).toHaveBeenCalledWith("me@example.com");
    const again = remove(change(dentist));
    finish();
    await again;
    expect(resumed).toHaveBeenCalledTimes(1);
  });
});
