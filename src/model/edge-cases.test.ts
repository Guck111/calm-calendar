// Edge cases of the event form, quick add, .ics and description display
import { allSettled, fork } from "effector";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent, EventDraft } from "../shared/api/types";

const requests: { method: string; path: string; body: unknown }[] = [];
vi.mock("../shared/api/bridge", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  googleRequest: async (_account: string, method: string, path: string, _query: unknown, body: unknown) => {
    requests.push({ method, path, body });
    return {};
  },
}));

const { saveEvent } = await import("../shared/api/calendar");
const editor = await import("./editor");
const { parseQuick, hasValidQuickDate } = await import("../shared/lib/quick");
const { parseTime } = await import("../shared/lib/ics");
const { plainText } = await import("../shared/lib/plain-text");

const event: CalendarEvent = {
  key: "c\u0000e1",
  id: "e1",
  calendarId: "c",
  account: "",
  title: "Встреча",
  start: new Date(2026, 10, 7, 14, 30),
  end: new Date(2026, 10, 7, 16, 30),
  allDay: false,
  recurring: false,
  location: "Офис",
};

const other: CalendarEvent = { ...event, key: "c\u0000e2", id: "e2", title: "Другое" };

beforeEach(() => void (requests.length = 0));

describe("saving sends only the changed fields", () => {
  it("a new title doesn't send the old time back to Google", async () => {
    await saveEvent({ ...editor.fromEvent(event), title: "Новое" });
    expect(requests).toEqual([{ method: "PATCH", path: "/calendar/v3/calendars/c/events/e1", body: { summary: "Новое" } }]);
  });

  it("start and end go together", async () => {
    await saveEvent(editor.applyChange(editor.fromEvent(event), { endTime: "17:00" }));
    expect(Object.keys(requests[0].body as object).sort()).toEqual(["end", "start"]);
  });

  it("nothing changed — no request", async () => {
    await saveEvent(editor.fromEvent(event));
    expect(requests).toEqual([]);
  });

  it("a new event is sent whole", async () => {
    const copy = editor.duplicateDraft(event, ["c"]);
    expect(copy.baseline).toBeUndefined();
    await saveEvent(copy);
    expect(requests[0]).toMatchObject({ method: "POST", body: { summary: "Встреча", location: "Офис" } });
  });
});

describe("a save that finishes after the card closed", () => {
  it("doesn't close the next opened event", async () => {
    let finish = () => {};
    const scope = fork({
      handlers: [[editor.saveFx, () => new Promise<void>((done) => (finish = done))]],
    });
    await allSettled(editor.eventOpened, { scope, params: event });
    await allSettled(editor.editClicked, { scope });
    await allSettled(editor.draftChanged, { scope, params: { title: "x" } });
    // allSettled waits for the whole scope, including the running save: launch without waiting
    const steps = [
      allSettled(editor.saveClicked, { scope }),
      allSettled(editor.editorClosed, { scope }),
      allSettled(editor.eventOpened, { scope, params: other }),
      allSettled(editor.editClicked, { scope }),
    ];
    finish();
    await Promise.all(steps);
    expect(scope.getState(editor.$draft)?.id).toBe("e2");
    expect(scope.getState(editor.$opened)?.id).toBe("e2");
  });

  it("closes its own card", async () => {
    const scope = fork({ handlers: [[editor.saveFx, async () => {}]] });
    await allSettled(editor.eventOpened, { scope, params: event });
    await allSettled(editor.editClicked, { scope });
    await allSettled(editor.saveClicked, { scope });
    expect(scope.getState(editor.$draft)).toBeNull();
  });
});

describe("the series question doesn't bypass the form check", () => {
  const occurrence: CalendarEvent = { ...event, recurring: true, recurringEventId: "w" };

  it("a change after Save withdraws the question, an invalid form isn't saved", async () => {
    const saved: unknown[] = [];
    const scope = fork({
      handlers: [
        [editor.loadSeriesFx, async () => []],
        [editor.saveFx, async (p: unknown) => void saved.push(p)],
      ],
    });
    await allSettled(editor.eventOpened, { scope, params: occurrence });
    await allSettled(editor.editClicked, { scope });
    await allSettled(editor.saveClicked, { scope });
    expect(scope.getState(editor.$askScope)).toBe("save");
    await allSettled(editor.draftChanged, { scope, params: { endTime: "10:00" } });
    expect(scope.getState(editor.$askScope)).toBeNull();
    await allSettled(editor.scopeChosen, { scope, params: "this" });
    expect(saved).toEqual([]);
  });
});

describe("dates and times in the form", () => {
  const base: EventDraft = {
    calendarId: "c",
    title: "",
    allDay: false,
    startDate: "2026-11-04",
    startTime: "09:00",
    endDate: "2026-11-04",
    endTime: "10:00",
    location: "",
    description: "",
    recurrence: [],
  };

  it("a cleared field stays empty and is an error, not the old value", () => {
    const next = editor.applyChange(base, { startTime: "" });
    expect(next.startTime).toBe("");
    expect(next.endTime).toBe("10:00");
    expect(editor.validate(next)).not.toBeNull();
    expect(editor.validate(editor.applyChange(base, { endDate: "" }))).not.toBeNull();
    expect(editor.validate({ ...base, allDay: true, startDate: "" })).not.toBeNull();
  });

  it("a nonexistent date is an error", () => {
    expect(editor.validate({ ...base, startDate: "2026-02-30", endDate: "2026-03-01" })).not.toBeNull();
  });

  it("the hour skipped by the switch to summer time is an error", () => {
    const warsaw = { ...base, timeZone: "Europe/Warsaw", startDate: "2026-03-29", endDate: "2026-03-29" };
    expect(editor.validate({ ...warsaw, startTime: "02:30", endTime: "04:00" })).not.toBeNull();
    expect(editor.validate({ ...warsaw, startTime: "03:00", endTime: "04:00" })).toBeNull();
  });
});

describe("quick add and .ics", () => {
  it("an impossible time is not turned into an all-day event", () => {
    const now = new Date(2026, 10, 16, 12);
    expect(hasValidQuickDate(parseQuick("Звонок завтра в 25:30", now, [], "ru"))).toBe(false);
    expect(hasValidQuickDate(parseQuick("call tomorrow 9:75", now, [], "en"))).toBe(false);
    expect(hasValidQuickDate(parseQuick("Звонок завтра в 23:30", now, [], "ru"))).toBe(true);
  });

  it(".ics: a nonexistent date or time is not shifted to another day", () => {
    expect(parseTime("20260230")).toBeNull();
    expect(parseTime("20261301")).toBeNull();
    expect(parseTime("20261111T250000")).toBeNull();
    expect(parseTime("20240229")).toEqual({ y: 2024, mo: 2, d: 29 });
  });
});

describe("description as text", () => {
  it("removes tags but keeps angle brackets of plain text", () => {
    expect(plainText("a < b > c")).toBe("a < b > c");
    expect(plainText("<p>one</p><b>two</b><br>three")).toBe("one\ntwo\nthree");
    expect(plainText("&amp;lt;")).toBe("&lt;");
  });
});
