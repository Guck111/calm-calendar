// Event card and form edge cases: real request handlers, drafts, validation and what follows each action
import { allSettled, createWatch, fork, scopeBind, type Scope as EffectorScope } from "effector";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../shared/api/calendar";
import { broadcast } from "../shared/api/bus";
import type { CalendarEvent, EventDraft } from "../shared/api/types";
import { t } from "../shared/i18n";
import { logError } from "../shared/lib/log";
import { sessionLost } from "./auth";
import { fetchCalendarsFx } from "./calendars";
import {
  $askScope,
  $busy,
  $draft,
  $editorError,
  $mode,
  $opened,
  $recurrenceEdited,
  $series,
  applyChange,
  createClicked,
  deleteClicked,
  deleteFx,
  deleteRequested,
  draftChanged,
  duplicateClicked,
  duplicateDraft,
  editCancelled,
  editClicked,
  eventOpened,
  fromEvent,
  loadSeriesFx,
  moveFx,
  patchFx,
  rsvpClicked,
  rsvpFx,
  saveClicked,
  saveFx,
  scopeChosen,
  slotClicked,
  validate,
} from "./editor";
import { $loadError, reloadRequested } from "./events";

vi.mock("../shared/api/calendar", async (original) => ({
  ...(await original<typeof import("../shared/api/calendar")>()),
  saveEvent: vi.fn(async () => undefined),
  deleteOccurrence: vi.fn(async () => undefined),
  respondToEvent: vi.fn(async () => undefined),
  loadRecurrence: vi.fn(async () => ["RRULE:FREQ=DAILY"]),
}));
vi.mock("../shared/api/bus", async (original) => ({ ...(await original<typeof import("../shared/api/bus")>()), broadcast: vi.fn() }));
vi.mock("../shared/lib/log", async (original) => ({ ...(await original<typeof import("../shared/lib/log")>()), logError: vi.fn() }));
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

const CAL = "me@x\u0000primary";
const ev = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  key: "k", id: "e1", calendarId: CAL, account: "me@x", title: "Dentist",
  start: new Date(2026, 10, 4, 9), end: new Date(2026, 10, 4, 10), allDay: false, recurring: false, timeZone: "Europe/Warsaw", ...over,
});
const occurrence = ev({ key: "o", id: "s_1", recurringEventId: "s", recurring: true });
const base: EventDraft = {
  calendarId: CAL, title: "x", allDay: false, startDate: "2026-11-04", startTime: "09:00", endDate: "2026-11-04", endTime: "10:00",
  location: "", description: "", recurrence: [],
};
const watch = (scope: EffectorScope, unit: Parameters<typeof createWatch>[0]["unit"]) => {
  const fn = vi.fn();
  createWatch({ unit, fn, scope });
  return fn;
};

describe("real request handlers", () => {
  it("save, delete, answer and series loading go to the calendar API", async () => {
    const scope = fork();
    await allSettled(saveFx, { scope, params: { draft: base, scope: "this" } });
    await allSettled(deleteFx, { scope, params: { draft: base, scope: "following" } });
    await allSettled(rsvpFx, { scope, params: { event: ev(), status: "accepted" } });
    await allSettled(loadSeriesFx, { scope, params: { calendarId: CAL, id: "s" } });
    expect(vi.mocked(api.saveEvent)).toHaveBeenCalledWith(base, "this");
    expect(vi.mocked(api.deleteOccurrence)).toHaveBeenCalledWith(base, "following");
    expect(vi.mocked(api.respondToEvent)).toHaveBeenCalledWith(ev(), "accepted");
    expect(vi.mocked(api.loadRecurrence)).toHaveBeenCalledWith(CAL, "s");
  });
});

describe("series rule of the open occurrence", () => {
  it("is empty while loading, filled or failed only for its own series", async () => {
    let answer!: (lines: string[]) => void;
    let fail!: () => void;
    const scope = fork({ handlers: [[loadSeriesFx, ({ id }: { id: string }) =>
      new Promise<string[]>((ok, no) => (id === "s" ? (answer = ok) : (fail = () => no({ kind: "network", message: "x" }))))]] });
    const own = allSettled(loadSeriesFx, { scope, params: { calendarId: CAL, id: "s" } });
    expect(scope.getState($series)).toEqual({ calendarId: CAL, id: "s", lines: null, failed: false });
    answer(["RRULE:FREQ=WEEKLY"]);
    await own;
    expect(scope.getState($series)?.lines).toEqual(["RRULE:FREQ=WEEKLY"]);
    const other = allSettled(loadSeriesFx, { scope, params: { calendarId: CAL, id: "other" } });
    fail();
    await other;
    expect(scope.getState($series)).toEqual({ calendarId: CAL, id: "other", lines: null, failed: true });
  });

  it("a late answer for another series or another calendar's copy changes nothing", async () => {
    const waiting = new Map<string, { ok: (l: string[]) => void; no: (e: unknown) => void }>();
    const scope = fork({ handlers: [[loadSeriesFx, ({ calendarId, id }: { calendarId: string; id: string }) =>
      new Promise<string[]>((ok, no) => waiting.set(`${calendarId}|${id}`, { ok, no }))]] });
    const load = (calendarId: string, id: string) => allSettled(loadSeriesFx, { scope, params: { calendarId, id } });
    const first = load(CAL, "s");
    const failing = load(CAL, "u");
    const current = load("other", "s");
    waiting.get(`${CAL}|s`)?.ok(["x"]);
    waiting.get(`${CAL}|u`)?.no({ kind: "network", message: "x" });
    waiting.get("other|s")?.ok(["RRULE:FREQ=DAILY"]);
    await Promise.all([first, failing, current]);
    expect(scope.getState($series)).toEqual({ calendarId: "other", id: "s", lines: ["RRULE:FREQ=DAILY"], failed: false });
  });
});

describe("draft from an event", () => {
  it("an untitled event has an empty title, missing text fields are empty", () => {
    expect(fromEvent(ev({ title: t.common.untitled }))).toMatchObject({ title: "", location: "", description: "" });
  });

  it("an all-day event ends on its last day in the form", () => {
    expect(fromEvent(ev({ allDay: true, start: new Date(2026, 10, 4), end: new Date(2026, 10, 7) }))).toMatchObject({ startDate: "2026-11-04", endDate: "2026-11-06" });
  });

  it("an occurrence's rule is unknown until loaded, a single event's rule is known to be empty", () => {
    expect(fromEvent(occurrence)).toMatchObject({ recurrence: [] });
    expect(fromEvent(occurrence).originalRecurrence).toBeUndefined();
    expect(fromEvent(occurrence, ["RRULE:FREQ=DAILY"])).toMatchObject({ recurrence: ["RRULE:FREQ=DAILY"], originalRecurrence: ["RRULE:FREQ=DAILY"] });
    expect(fromEvent(ev())).toMatchObject({ recurrence: [], originalRecurrence: [] });
  });

  it("guests and attachments only for one's own meeting", () => {
    expect(fromEvent(ev())).toMatchObject({ guests: [], attachments: [] });
    const theirs = fromEvent(ev({ organizerSelf: false }));
    expect(theirs).not.toHaveProperty("guests");
    expect(theirs).not.toHaveProperty("attachments");
  });

  it("a copy without guests or attachments has empty lists and nothing to upload", () => {
    expect(duplicateDraft(ev(), [CAL])).toMatchObject({ guests: [], attachments: [], attachmentsChanged: false });
  });
});

describe("new event drafts", () => {
  it("a clicked slot gives an hour in the first writable calendar, all-day ends the same day", async () => {
    const scope = fork({ handlers: [[fetchCalendarsFx, async () => ({ calendars: [{ id: CAL, accessRole: "owner", selected: true } as never], failed: [], lost: [] })]] });
    await allSettled(fetchCalendarsFx, { scope, params: { accounts: ["me@x"], id: 0 } });
    await allSettled(slotClicked, { scope, params: { start: new Date(2026, 10, 4, 14) } });
    expect(scope.getState($draft)).toEqual({
      calendarId: CAL, title: "", allDay: false, startDate: "2026-11-04", startTime: "14:00", endDate: "2026-11-04", endTime: "15:00",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, location: "", description: "", recurrence: [], guests: [], addMeet: false, attachments: [],
    });
    await allSettled(slotClicked, { scope, params: { start: new Date(2026, 10, 4), allDay: true } });
    expect(scope.getState($draft)).toMatchObject({ allDay: true, startDate: "2026-11-04", endDate: "2026-11-04" });
  });

  it("without a writable calendar the draft has no calendar", async () => {
    const scope = fork();
    await allSettled(slotClicked, { scope, params: { start: new Date(2026, 10, 4, 14) } });
    expect(scope.getState($draft)?.calendarId).toBe("");
  });

  it("'New event' starts at the next half hour", async () => {
    vi.useFakeTimers();
    const scope = fork();
    for (const [now, start, end] of [[[10, 10, 15], "10:30", "11:30"], [[10, 30, 0], "11:00", "12:00"], [[10, 45, 30], "11:00", "12:00"]] as const) {
      vi.setSystemTime(new Date(2026, 10, 4, now[0], now[1], now[2], 500));
      await allSettled(createClicked, { scope });
      expect(scope.getState($draft)).toMatchObject({ allDay: false, startTime: start, endTime: end });
    }
  });
});

describe("changes in the form", () => {
  const weekly = { ...base, recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"] };

  it("a single event's rule follows a new start day, an occurrence's or an unreadable rule stays", () => {
    expect(applyChange(weekly, { startDate: "2026-11-05" }).recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=TH"]);
    expect(applyChange({ ...weekly, recurringEventId: "s" }, { startDate: "2026-11-05" }).recurrence).toEqual(weekly.recurrence);
    const odd = { ...base, recurrence: ["RRULE:FREQ=MONTHLY;BYSETPOS=-1;BYDAY=MO,TU"] };
    expect(applyChange(odd, { startDate: "2026-11-05" }).recurrence).toEqual(odd.recurrence);
  });

  it("the same time zone again keeps the end's own time zone", () => {
    expect(applyChange({ ...base, timeZone: "Europe/Warsaw", endTimeZone: "Asia/Tokyo" }, { timeZone: "Europe/Warsaw" }).endTimeZone).toBe("Asia/Tokyo");
  });

  it("switching to all-day rewrites the rule's end as a date", () => {
    const until = { ...base, timeZone: "Europe/Warsaw", recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261231T225959Z"] };
    expect(applyChange(until, { allDay: true }).recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261231"]);
  });

  it("an all-day event keeps its length when moved, an invalid start leaves the end alone", () => {
    const trip = { ...base, allDay: true, startDate: "2026-11-04", endDate: "2026-11-06" };
    expect(applyChange(trip, { startDate: "2026-11-10" })).toMatchObject({ endDate: "2026-11-12" });
    expect(applyChange(trip, { startDate: "2026-02-30" })).toMatchObject({ startDate: "2026-02-30", endDate: "2026-11-06" });
  });
});

describe("form validation", () => {
  const check = (patch: Partial<EventDraft>) => validate({ ...base, timeZone: "Europe/Warsaw", ...patch });

  it.each([
    { startDate: "x2026-11-04" }, { endDate: "2026-11-04x" }, { startDate: "2026-02-30" }, { startDate: "2026-13-01" },
    { startDate: "2025-02-29" }, { startTime: "24:00" }, { endTime: "10:60" }, { startTime: "x09:00" }, { endTime: "10:00x" },
  ])("rejects %o", (patch) => expect(check(patch)).toBe(t.errors.checkDateTime));

  it("the last minute of the day is a valid time, times don't matter for all-day events", () => {
    expect(check({ endTime: "23:59" })).toBeNull();
    expect(check({ allDay: true, startTime: "", endTime: "" })).toBeNull();
  });

  it("a timed event must end after it starts, an all-day one may end the same day", () => {
    expect(check({ endTime: "09:00" })).toBe(t.errors.endBeforeStart);
    expect(check({ allDay: true, endDate: "2026-11-04" })).toBeNull();
    expect(check({ allDay: true, endDate: "2026-11-03" })).toBe(t.errors.endBeforeStart);
  });
});

describe("the card and the form", () => {
  const handlers = (over: unknown[][] = []) => [
    [saveFx, async () => undefined], [deleteFx, async () => undefined], [rsvpFx, async () => undefined],
    [loadSeriesFx, async () => ["RRULE:FREQ=DAILY"]], [moveFx, async () => undefined], [patchFx, async () => undefined], ...over,
  ] as never;

  it("a save failure in the open form shows in the form", async () => {
    const scope = fork({ handlers: handlers([[saveFx, () => Promise.reject({ kind: "google", message: "Nope" })]]) });
    await allSettled(eventOpened, { scope, params: ev() });
    await allSettled(saveClicked, { scope });
    expect(scope.getState($editorError)).toBe("Nope");
  });

  it("opening an event switches to viewing, a new slot or draft forgets the opened event", async () => {
    const scope = fork({ handlers: handlers() });
    await allSettled(createClicked, { scope });
    await allSettled(eventOpened, { scope, params: ev() });
    expect(scope.getState($mode)).toBe("view");
    await allSettled(slotClicked, { scope, params: { start: new Date(2026, 10, 4, 14) } });
    expect(scope.getState($opened)).toBeNull();
  });

  it("the series rule fills an opened occurrence's form once, only for its own series", async () => {
    let rule = ["RRULE:FREQ=DAILY"];
    const scope = fork({ handlers: handlers([[loadSeriesFx, async () => rule]]) });
    await allSettled(eventOpened, { scope, params: occurrence });
    expect(scope.getState($draft)?.recurrence).toEqual(["RRULE:FREQ=DAILY"]);
    rule = ["RRULE:FREQ=WEEKLY"];
    await allSettled(loadSeriesFx, { scope, params: { calendarId: CAL, id: "s" } });
    expect(scope.getState($draft)?.recurrence).toEqual(["RRULE:FREQ=DAILY"]);
    const fresh = fork({ handlers: handlers([[loadSeriesFx, ({ calendarId }: { calendarId: string }) =>
      calendarId === CAL ? new Promise(() => {}) : Promise.resolve(["RRULE:FREQ=WEEKLY"])]]) });
    scopeBind(eventOpened, { scope: fresh })(occurrence);
    await scopeBind(loadSeriesFx, { scope: fresh })({ calendarId: "other", id: "s" });
    expect(fresh.getState($draft)?.originalRecurrence).toBeUndefined();
  });

  it("'Cancel' brings back the occurrence with its series rule", async () => {
    const scope = fork({ handlers: handlers() });
    await allSettled(eventOpened, { scope, params: occurrence });
    await allSettled(editClicked, { scope });
    await allSettled(draftChanged, { scope, params: { title: "Changed", recurrence: [] } });
    await allSettled(editCancelled, { scope });
    expect(scope.getState($draft)).toMatchObject({ title: "Dentist", recurrence: ["RRULE:FREQ=DAILY"] });
  });

  it("a copy of an event from a read-only calendar goes to the first writable one", async () => {
    const scope = fork({ handlers: handlers([[fetchCalendarsFx, async () => ({ calendars: [{ id: "mine", accessRole: "owner", selected: true }, { id: CAL, accessRole: "reader", selected: true }] as never, failed: [], lost: [] })]]) });
    await allSettled(fetchCalendarsFx, { scope, params: { accounts: ["me@x"], id: 0 } });
    await allSettled(eventOpened, { scope, params: ev() });
    await allSettled(duplicateClicked, { scope });
    expect(scope.getState($draft)).toMatchObject({ calendarId: "mine" });
    expect(scope.getState($mode)).toBe("edit");
  });

  it("an answer to an invitation marks only the card it was given in", async () => {
    const scope = fork({ handlers: handlers() });
    const card = ev({ attendees: [{ email: "me@x", self: true, responseStatus: "needsAction" }] });
    await allSettled(eventOpened, { scope, params: card });
    await allSettled(rsvpFx, { scope, params: { event: ev({ key: "other" }), status: "accepted" } });
    expect(scope.getState($opened)).toBe(card);
  });

  it("an answer that failed shows in the card; the card is busy while answering", async () => {
    let finish!: () => void;
    const scope = fork({ handlers: handlers([[rsvpFx, () => new Promise<void>((_, no) => (finish = () => no({ kind: "google", message: "No answer" })))]]) });
    await allSettled(eventOpened, { scope, params: ev() });
    const answering = allSettled(rsvpClicked, { scope, params: "accepted" });
    await Promise.resolve();
    expect(scope.getState($busy)).toBe(true);
    finish();
    await answering;
    expect(scope.getState($editorError)).toBe("No answer");
  });

  it("no rule was edited without a form", () => {
    expect(fork().getState($recurrenceEdited)).toBe(false);
  });

  it("saving an invalid form shows why and asks nothing", async () => {
    const scope = fork({ handlers: handlers() });
    await allSettled(eventOpened, { scope, params: occurrence });
    await allSettled(draftChanged, { scope, params: { endTime: "08:00" } });
    await allSettled(saveClicked, { scope });
    expect(scope.getState($editorError)).toBe(t.errors.endBeforeStart);
    expect(scope.getState($askScope)).toBeNull();
  });

  it("deleting an occurrence asks which ones, deleting a single event or a new draft doesn't", async () => {
    const requested = vi.fn();
    const scope = fork({ handlers: handlers() });
    createWatch({ unit: deleteRequested, fn: requested, scope });
    await allSettled(eventOpened, { scope, params: occurrence });
    await allSettled(deleteClicked, { scope });
    expect(scope.getState($askScope)).toBe("delete");
    await allSettled(scopeChosen, { scope, params: "following" });
    expect(requested).toHaveBeenCalledWith(expect.objectContaining({ scope: "following", event: occurrence }));
    await allSettled(createClicked, { scope });
    await allSettled(deleteClicked, { scope });
    expect(scope.getState($askScope)).toBeNull();
    await allSettled(scopeChosen, { scope, params: "this" });
    expect(requested).toHaveBeenCalledTimes(1);
  });

  it("the answer to a save question saves, it never deletes", async () => {
    const requested = vi.fn();
    const scope = fork({ handlers: handlers() });
    createWatch({ unit: deleteRequested, fn: requested, scope });
    await allSettled(eventOpened, { scope, params: occurrence });
    await allSettled(saveClicked, { scope });
    expect(scope.getState($askScope)).toBe("save");
    await allSettled(scopeChosen, { scope, params: "this" });
    expect(requested).not.toHaveBeenCalled();
  });

  it("delete is ignored while an answer is on the way", async () => {
    let finish!: () => void;
    const scope = fork({ handlers: handlers([[rsvpFx, () => new Promise<void>((done) => (finish = done))]]) });
    await allSettled(eventOpened, { scope, params: occurrence });
    const answering = allSettled(rsvpClicked, { scope, params: "accepted" });
    scopeBind(deleteClicked, { scope })();
    expect(scope.getState($askScope)).toBeNull();
    finish();
    await answering;
  });
});

describe("what follows each action", () => {
  it("failures go to the bar, reloads and other windows follow every finished change", async () => {
    const fail = (message: string) => () => Promise.reject({ kind: "google", message });
    const scope = fork({ handlers: [[moveFx, fail("m")], [patchFx, fail("p")], [deleteFx, fail("d")], [saveFx, async () => undefined], [rsvpFx, async () => undefined]] });
    const reloads = watch(scope, reloadRequested);
    await allSettled(moveFx, { scope, params: { event: ev(), start: new Date(), end: new Date() } });
    expect(scope.getState($loadError)).toBe(t.errors.moveFailed("m"));
    await allSettled(patchFx, { scope, params: { draft: { ...base, id: "e1" }, patch: { colorId: "1" } } });
    expect(scope.getState($loadError)).toBe(t.errors.changeFailed("p"));
    await allSettled(deleteFx, { scope, params: { draft: base, scope: "this" } });
    expect(scope.getState($loadError)).toBe(t.errors.deleteFailed("d"));
    await allSettled(saveFx, { scope, params: { draft: base, scope: "this" } });
    await allSettled(rsvpFx, { scope, params: { event: ev(), status: "declined" } });
    expect(reloads).toHaveBeenCalledTimes(5);
  });

  it("every successful change tells the other windows", async () => {
    const scope = fork({ handlers: [[moveFx, async () => undefined], [patchFx, async () => undefined], [deleteFx, async () => undefined], [saveFx, async () => undefined], [rsvpFx, async () => undefined]] });
    await allSettled(moveFx, { scope, params: { event: ev(), start: new Date(), end: new Date() } });
    await allSettled(patchFx, { scope, params: { draft: { ...base, id: "e1" }, patch: { colorId: "1" } } });
    await allSettled(deleteFx, { scope, params: { draft: base, scope: "this" } });
    await allSettled(saveFx, { scope, params: { draft: base, scope: "this" } });
    await allSettled(rsvpFx, { scope, params: { event: ev(), status: "declined" } });
    expect(vi.mocked(broadcast).mock.calls).toEqual(Array(5).fill(["events-changed", { from: "main" }]));
  });

  it("failures of the app itself are logged by action, an expired sign-in from any action ends the session", async () => {
    const bug = { kind: "other", message: "bug" };
    const expired = { kind: "not_signed_in", message: "expired" };
    const scope = fork({ handlers: [[saveFx, () => Promise.reject(bug)], [deleteFx, () => Promise.reject(bug)], [moveFx, () => Promise.reject(bug)]] });
    await allSettled(saveFx, { scope, params: { draft: base, scope: "this" } });
    await allSettled(deleteFx, { scope, params: { draft: base, scope: "this" } });
    await allSettled(moveFx, { scope, params: { event: ev(), start: new Date(), end: new Date() } });
    expect(vi.mocked(logError).mock.calls.map(([m]) => m)).toEqual(["save event failed", "delete event failed", "move event failed"]);

    const lost = fork({ handlers: [[saveFx, () => Promise.reject(expired)], [deleteFx, () => Promise.reject(expired)], [moveFx, () => Promise.reject(expired)],
      [loadSeriesFx, () => Promise.reject(expired)], [rsvpFx, () => Promise.reject(expired)], [rsvpFx, () => Promise.reject(expired)]] });
    const session = watch(lost, sessionLost);
    await allSettled(saveFx, { scope: lost, params: { draft: base, scope: "this" } });
    await allSettled(deleteFx, { scope: lost, params: { draft: base, scope: "this" } });
    await allSettled(moveFx, { scope: lost, params: { event: ev(), start: new Date(), end: new Date() } });
    await allSettled(loadSeriesFx, { scope: lost, params: { calendarId: CAL, id: "s" } });
    await allSettled(rsvpFx, { scope: lost, params: { event: ev(), status: "accepted" } });
    expect(session).toHaveBeenCalledTimes(5);
    expect(vi.mocked(logError)).toHaveBeenCalledTimes(3);
  });
});
