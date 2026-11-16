import { allSettled, createWatch, fork } from "effector";
import { describe, expect, it } from "vitest";
import type { CalendarEvent, EventDraft } from "../shared/api/types";
import { $loadError } from "./events";
import {
  $askScope,
  $draft,
  $editorError,
  $mode,
  $recurrenceEdited,
  applyChange,
  deleteClicked,
  deleteRequested,
  draftChanged,
  draftOpened,
  editorClosed,
  editCancelled,
  editClicked,
  eventOpened,
  loadSeriesFx,
  saveClicked,
  saveFx,
  scopeCancelled,
  scopeChosen,
  validate,
} from "./editor";

const base: EventDraft = {
  calendarId: "primary",
  title: "",
  allDay: false,
  startDate: "2026-11-04",
  startTime: "09:00",
  endDate: "2026-11-04",
  endTime: "10:30",
  location: "",
  description: "",
  recurrence: [],
};

describe("event form", () => {
  it("moving the start moves the end, keeping the duration", () => {
    const next = applyChange(base, { startTime: "23:00" });
    expect([next.endDate, next.endTime]).toEqual(["2026-11-05", "00:30"]);
  });

  it("changing the title doesn't touch the time", () => {
    expect(applyChange(base, { title: "x" }).endTime).toBe("10:30");
  });

  it("an all-day event keeps its number of days", () => {
    const multi = { ...base, allDay: true, endDate: "2026-11-06" };
    expect(applyChange(multi, { startDate: "2026-11-10" }).endDate).toBe("2026-11-12");
  });

  it("end before start is an error, a one-day all-day event is not", () => {
    expect(validate({ ...base, endTime: "08:00" })).not.toBeNull();
    expect(validate({ ...base, allDay: true, endDate: "2026-11-04" })).toBeNull();
    expect(validate({ ...base, calendarId: "" })).not.toBeNull();
  });
});

const event: CalendarEvent = {
  key: "c\u0000e1",
  id: "e1",
  calendarId: "c", account: "",
  title: "Польский",
  start: new Date(2026, 10, 7, 14, 30),
  end: new Date(2026, 10, 7, 16, 30),
  allDay: false,
  recurring: false,
};

describe("viewing and editing an event", () => {
  it("clicking an event opens the view, 'Edit' opens the form", async () => {
    const scope = fork();
    await allSettled(eventOpened, { scope, params: event });
    expect(scope.getState($mode)).toBe("view");
    await allSettled(editClicked, { scope });
    expect(scope.getState($mode)).toBe("edit");
  });

  it("'Cancel' returns to the view and discards unsaved edits", async () => {
    const scope = fork();
    await allSettled(eventOpened, { scope, params: event });
    await allSettled(editClicked, { scope });
    await allSettled(draftChanged, { scope, params: { title: "Другое" } });
    await allSettled(editCancelled, { scope });
    expect(scope.getState($mode)).toBe("view");
    expect(scope.getState($draft)?.title).toBe("Польский");
  });
});

const occurrence: CalendarEvent = {
  ...event,
  key: "c\u0000w_20261111",
  id: "w_20261111",
  title: "Работа",
  start: new Date(2026, 10, 11, 12),
  end: new Date(2026, 10, 11, 18),
  recurring: true,
  recurringEventId: "w",
  originalStart: { dateTime: new Date(2026, 10, 11, 12).toISOString() },
};

const WEEKDAYS = ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"];

describe("recurrence rule in the form", () => {
  it("for a new event the rule follows the start date", () => {
    const weekly = { ...base, recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"] };
    expect(applyChange(weekly, { startDate: "2026-11-05" }).recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=TH"]);
  });

  it("for an occurrence of a series moving the date doesn't change the rule", () => {
    const one = { ...base, recurringEventId: "w", recurrence: WEEKDAYS, originalRecurrence: WEEKDAYS };
    expect(applyChange(one, { startDate: "2026-11-05" }).recurrence).toEqual(WEEKDAYS);
  });
});

describe("series occurrence", () => {
  const opened = async () => {
    const calls: { save: unknown[]; del: unknown[] } = { save: [], del: [] };
    const scope = fork({
      handlers: [
        [loadSeriesFx, async () => WEEKDAYS],
        [saveFx, async (p: unknown) => void calls.save.push(p)],
      ],
    });
    // deletion goes to Google later ('Undo' bar); what matters here is the request itself
    createWatch({ unit: deleteRequested, scope, fn: (p) => void calls.del.push(p) });
    await allSettled(eventOpened, { scope, params: occurrence });
    return { scope, calls };
  };

  it("the series rule is loaded into the draft", async () => {
    const { scope } = await opened();
    expect(scope.getState($draft)).toMatchObject({ recurrence: WEEKDAYS, originalRecurrence: WEEKDAYS });
  });

  it("before saving, asks which occurrences to apply to", async () => {
    const { scope, calls } = await opened();
    await allSettled(editClicked, { scope });
    await allSettled(draftChanged, { scope, params: { startTime: "13:00" } });
    await allSettled(saveClicked, { scope });
    expect(scope.getState($askScope)).toBe("save");
    expect(calls.save).toHaveLength(0);

    await allSettled(scopeChosen, { scope, params: "following" });
    expect(calls.save).toMatchObject([{ scope: "following", draft: { startTime: "13:00", recurringEventId: "w" } }]);
    expect(scope.getState($askScope)).toBeNull();
  });

  it("deletion asks too; 'Cancel' deletes nothing", async () => {
    const { scope, calls } = await opened();
    await allSettled(deleteClicked, { scope });
    expect(scope.getState($askScope)).toBe("delete");
    await allSettled(scopeCancelled, { scope });
    expect(calls.del).toHaveLength(0);
    await allSettled(deleteClicked, { scope });
    await allSettled(scopeChosen, { scope, params: "this" });
    expect(calls.del).toMatchObject([{ scope: "this", draft: { id: "w_20261111" } }]);
  });

  it("a changed rule is detected", async () => {
    const { scope } = await opened();
    await allSettled(editClicked, { scope });
    expect(scope.getState($recurrenceEdited)).toBe(false);
    await allSettled(draftChanged, { scope, params: { recurrence: ["RRULE:FREQ=DAILY"] } });
    expect(scope.getState($recurrenceEdited)).toBe(true);
  });

  it("a regular event is saved without asking", async () => {
    const { scope, calls } = await opened();
    await allSettled(eventOpened, { scope, params: event });
    await allSettled(editClicked, { scope });
    await allSettled(saveClicked, { scope });
    expect(scope.getState($askScope)).toBeNull();
    expect(calls.save).toMatchObject([{ scope: "this", draft: { id: "e1" } }]);
  });
});

describe("closing the form while it saves", () => {
  const deferred = () => {
    let resolve!: () => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<void>((ok, fail) => ((resolve = ok), (reject = fail)));
    return { promise, resolve, reject };
  };

  const saveThenOpenAnother = async (finish: (save: ReturnType<typeof deferred>) => void) => {
    const save = deferred();
    const scope = fork({ handlers: [[saveFx, () => save.promise]] });
    await allSettled(draftOpened, { scope, params: { ...base, title: "First" } });
    // allSettled waits for the open save too, so the next steps start without waiting
    const steps = [
      allSettled(saveClicked, { scope }),
      allSettled(editorClosed, { scope }),
      allSettled(draftOpened, { scope, params: { ...base, title: "Second" } }),
    ];
    finish(save);
    await Promise.all(steps);
    return scope;
  };

  it("the end of the first save keeps the second draft open", async () => {
    const scope = await saveThenOpenAnother((save) => save.resolve());
    expect(scope.getState($draft)?.title).toBe("Second");
  });

  it("an error of the first save goes to the bar, not into the second form", async () => {
    const scope = await saveThenOpenAnother((save) => save.reject({ kind: "network", message: "offline" }));
    expect(scope.getState($draft)?.title).toBe("Second");
    expect(scope.getState($editorError)).toBeNull();
    expect(scope.getState($loadError)).toContain("offline");
  });
});

describe("same series in two accounts", () => {
  it("the rule of the copy in another calendar does not fill the open one", async () => {
    const rules: Record<string, { promise: Promise<string[]>; resolve: (v: string[]) => void }> = {};
    for (const calendarId of ["home", "work"]) {
      let resolve!: (v: string[]) => void;
      rules[calendarId] = { promise: new Promise<string[]>((ok) => (resolve = ok)), resolve };
    }
    const scope = fork({
      handlers: [[loadSeriesFx, ({ calendarId }: { calendarId: string }) => rules[calendarId].promise]],
    });
    const steps = [
      allSettled(eventOpened, { scope, params: { ...occurrence, calendarId: "home", key: "home w_20261111" } }),
      allSettled(eventOpened, { scope, params: { ...occurrence, calendarId: "work", key: "work w_20261111" } }),
    ];
    rules.home.resolve(["RRULE:FREQ=DAILY"]);
    await Promise.resolve();
    rules.work.resolve(WEEKDAYS);
    await Promise.all(steps);
    expect(scope.getState($draft)).toMatchObject({ calendarId: "work", recurrence: WEEKDAYS, originalRecurrence: WEEKDAYS });
  });
});
