import { describe, expect, it } from "vitest";
import { draftToBody, followingRecurrence, planFollowing, toCalendarEvent } from "./calendar";
import { utcStamp } from "../lib/rrule";
import type { EventDraft } from "./types";

const draft = (over: Partial<EventDraft> = {}): EventDraft => ({
  calendarId: "primary",
  title: "  Встреча ",
  allDay: false,
  startDate: "2026-11-04",
  startTime: "09:00",
  endDate: "2026-11-04",
  endTime: "10:30",
  location: "",
  description: "",
  recurrence: [],
  ...over,
});

describe("Google events", () => {
  it("all-day event from Google: end is exclusive", () => {
    const e = toCalendarEvent("c", {
      id: "1",
      summary: "Отпуск",
      start: { date: "2026-11-07" },
      end: { date: "2026-11-09" },
    });
    expect(e?.allDay).toBe(true);
    expect(e?.start).toEqual(new Date(2026, 10, 7));
    expect(e?.end).toEqual(new Date(2026, 10, 9));
  });

  it("cancelled and empty events are dropped, an untitled one gets a placeholder", () => {
    expect(toCalendarEvent("c", { id: "1", status: "cancelled", start: { date: "2026-11-07" } })).toBeNull();
    expect(toCalendarEvent("c", { id: "2" })).toBeNull();
    expect(toCalendarEvent("c", { id: "3", start: { dateTime: "2026-11-04T09:00:00Z" } })?.title).toBe(
      "(без названия)",
    );
  });

  it("a timed draft becomes dateTime and clears date", () => {
    const body = draftToBody(draft());
    expect(body.summary).toBe("Встреча");
    expect(body.start).toMatchObject({ date: null, dateTime: new Date(2026, 10, 4, 9).toISOString() });
    expect(body.end).toMatchObject({ dateTime: new Date(2026, 10, 4, 10, 30).toISOString() });
  });

  it("all-day draft: last day inclusive in the form, exclusive in Google", () => {
    const body = draftToBody(draft({ allDay: true, endDate: "2026-11-05" }));
    expect(body.start).toEqual({ date: "2026-11-04", dateTime: null, timeZone: null });
    expect(body.end).toEqual({ date: "2026-11-06", dateTime: null, timeZone: null });
  });
});

// series "Work" on weekdays from November 2, 2026, 12:00–18:00; edit the occurrence of November 11
const at = (d: number, h: number) => new Date(2026, 10, d, h).toISOString();
const master = {
  id: "w",
  summary: "Работа",
  attendees: [{ email: "boss@example.com" }],
  conferenceData: { conferenceSolution: { name: "Google Meet" }, entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/abc" }] },
  etag: "x",
  iCalUID: "w@google.com",
  recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;COUNT=20", "EXDATE:20261104T110000Z"],
  start: { dateTime: at(2, 12) },
  end: { dateTime: at(2, 18) },
};
const occurrence = (over: Partial<EventDraft> = {}): EventDraft =>
  draft({
    id: "w_20261111",
    title: "Работа",
    startDate: "2026-11-11",
    startTime: "13:00",
    endDate: "2026-11-11",
    endTime: "19:00",
    recurringEventId: "w",
    originalStart: { dateTime: at(11, 12) },
    recurrence: master.recurrence,
    originalRecurrence: master.recurrence,
    ...over,
  });

describe("'this and following'", () => {
  it("from the middle of a series: a new series with the same attendees and the old one trimmed", () => {
    const plan = planFollowing(occurrence(), master, 7);
    expect(plan.kind).toBe("split");
    if (plan.kind !== "split") return;
    expect(plan.create).toMatchObject({
      summary: "Работа",
      attendees: master.attendees,
      conferenceData: master.conferenceData,
      start: { dateTime: at(11, 13) },
      // 7 of 20 occurrences have passed — 13 remain; EXDATE is kept
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;COUNT=13", "EXDATE:20261104T110000Z"],
    });
    expect(plan.create).not.toHaveProperty("etag");
    expect(plan.create).not.toHaveProperty("iCalUID");
    expect(plan.truncate.recurrence).toEqual([
      `RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;UNTIL=${utcStamp(new Date(2026, 10, 11, 11, 59, 59))}`,
      "EXDATE:20261104T110000Z",
    ]);
  });

  it("from the first occurrence — editing the whole series", () => {
    const plan = planFollowing(occurrence({ startDate: "2026-11-02", originalStart: { dateTime: at(2, 12) } }), master, 0);
    expect(plan).toMatchObject({ kind: "series", patch: { start: { dateTime: at(2, 13) } } });
  });

  it("a new rule from the form is taken as is", () => {
    const edited = occurrence({ recurrence: ["RRULE:FREQ=DAILY"] });
    expect(followingRecurrence(edited, master, 7)).toEqual(["RRULE:FREQ=DAILY"]);
  });

  it("a weekly rule with one day follows the move", () => {
    const weekly = { ...master, recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"] };
    const moved = occurrence({ startDate: "2026-11-12", recurrence: weekly.recurrence, originalRecurrence: weekly.recurrence });
    expect(followingRecurrence(moved, weekly, 0)).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=TH"]);
  });

  it("if the rule didn't load, the series rule is used", () => {
    expect(followingRecurrence(occurrence({ recurrence: [], originalRecurrence: undefined }), master, 0)[0]).toBe(
      "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;COUNT=20",
    );
  });
});
