import { allSettled, createWatch, fork } from "effector";
import { describe, expect, it } from "vitest";
import type { CalendarEvent, EventDraft } from "../shared/api/types";
import {
  $askScope,
  $draft,
  $mode,
  $recurrenceEdited,
  applyChange,
  deleteClicked,
  deleteRequested,
  draftChanged,
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
