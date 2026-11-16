// Event time zone: read from Google, kept on edit, drag and series edit
import { allSettled, fork } from "effector";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent, EventDraft } from "../shared/api/types";

const googleRequest = vi.fn();
vi.mock(import("../shared/api/bridge"), async (importOriginal) => ({
  ...(await importOriginal()),
  googleRequest: (...args: unknown[]) => googleRequest(...args),
}));

const { draftToBody, followingRecurrence, saveEvent, toCalendarEvent } = await import("../shared/api/calendar");
const { applyChange, fromEvent, moveFx } = await import("./editor");
const { buildRecurrence, parseRecurrence } = await import("../shared/lib/rrule");
const { localTimeZone } = await import("../shared/lib/date");

beforeEach(() => {
  googleRequest.mockReset();
  googleRequest.mockResolvedValue({});
});

const NY = "America/New_York";
const TOKYO = "Asia/Tokyo";

/** a call at 9:00 New York time, November 4, 2026 (UTC−5) */
const nyCall = (): CalendarEvent =>
  toCalendarEvent("c", {
    id: "e1",
    summary: "Созвон",
    start: { dateTime: "2026-11-04T09:00:00-05:00", timeZone: NY },
    end: { dateTime: "2026-11-04T10:00:00-05:00", timeZone: NY },
  }) as CalendarEvent;

const patches = () =>
  googleRequest.mock.calls.filter((c) => c[1] === "PATCH").map((c) => c[4] as ReturnType<typeof draftToBody>);

describe("event time zone from Google", () => {
  it("taken from start.timeZone, without it — the calendar's time zone; all-day events have none", () => {
    expect(nyCall().timeZone).toBe(NY);
    const plain = toCalendarEvent("c", { id: "2", start: { dateTime: "2026-11-04T09:00:00Z" } }, TOKYO);
    expect(plain?.timeZone).toBe(TOKYO);
    const allDay = toCalendarEvent("c", { id: "3", start: { date: "2026-11-04" } }, TOKYO);
    expect(allDay?.timeZone).toBeUndefined();
  });

  it("a separate end time zone is remembered only if it differs", () => {
    expect(nyCall().endTimeZone).toBeUndefined();
    const flight = toCalendarEvent("c", {
      id: "f",
      start: { dateTime: "2026-11-04T09:00:00-05:00", timeZone: NY },
      end: { dateTime: "2026-11-05T13:00:00+09:00", timeZone: TOKYO },
    });
    expect(flight?.endTimeZone).toBe(TOKYO);
  });

  it("in the form, time follows the event's time zone clock", () => {
    const d = fromEvent(nyCall());
    expect([d.startDate, d.startTime, d.endTime, d.timeZone]).toEqual(["2026-11-04", "09:00", "10:00", NY]);
  });

  it("saving without edits changes neither the instant nor the time zone", () => {
    const body = draftToBody(fromEvent(nyCall()));
    expect(body.start).toMatchObject({ dateTime: "2026-11-04T14:00:00.000Z", timeZone: NY });
    expect(body.end).toMatchObject({ dateTime: "2026-11-04T15:00:00.000Z", timeZone: NY });
  });

  it("editing the time in the form follows the event's time zone clock", () => {
    const d = applyChange(fromEvent(nyCall()), { startTime: "11:00" });
    expect(draftToBody(d).start).toMatchObject({ dateTime: "2026-11-04T16:00:00.000Z", timeZone: NY });
  });

  it("changing the time zone keeps the clock in the form and changes the instant", () => {
    const d = applyChange(fromEvent(nyCall()), { timeZone: TOKYO });
    expect([d.startTime, d.endTime]).toEqual(["09:00", "10:00"]);
    expect(draftToBody(d).start).toMatchObject({ dateTime: "2026-11-04T00:00:00.000Z", timeZone: TOKYO });
  });

  it("the end time zone is kept as long as the time zone in the form wasn't changed", () => {
    const flight = toCalendarEvent("c", {
      id: "f",
      start: { dateTime: "2026-11-04T09:00:00-05:00", timeZone: NY },
      end: { dateTime: "2026-11-05T13:00:00+09:00", timeZone: TOKYO },
    }) as CalendarEvent;
    const d = fromEvent(flight);
    expect(draftToBody(d).end).toMatchObject({ dateTime: "2026-11-05T04:00:00.000Z", timeZone: TOKYO });
    const changed = applyChange(d, { timeZone: "Europe/London" });
    expect(draftToBody(changed).end).toMatchObject({ timeZone: "Europe/London" });
  });

  it("new event — in the system time zone", () => {
    const d: EventDraft = {
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
    expect(draftToBody(d).start).toMatchObject({ timeZone: localTimeZone() });
  });

  it("dragging keeps the event's time zone", async () => {
    const e = nyCall();
    const hour = 3_600_000;
    await allSettled(moveFx, {
      scope: fork(),
      params: { event: e, start: new Date(e.start.getTime() + hour), end: new Date(e.end.getTime() + hour) },
    });
    expect(patches()).toMatchObject([
      {
        start: { dateTime: "2026-11-04T15:00:00.000Z", timeZone: NY },
        end: { dateTime: "2026-11-04T16:00:00.000Z", timeZone: NY },
      },
    ]);
  });

  it("editing an occurrence 'only this' keeps the time zone", async () => {
    const e = toCalendarEvent("c", {
      id: "s_1",
      recurringEventId: "s",
      originalStartTime: { dateTime: "2026-11-04T09:00:00-05:00", timeZone: NY },
      start: { dateTime: "2026-11-04T09:00:00-05:00", timeZone: NY },
      end: { dateTime: "2026-11-04T10:00:00-05:00", timeZone: NY },
    }) as CalendarEvent;
    await saveEvent(applyChange(fromEvent(e, []), { startTime: "10:00" }), "this");
    expect(patches()[0].start).toMatchObject({ dateTime: "2026-11-04T15:00:00.000Z", timeZone: NY });
  });
});

describe("recurrence rule in the event's time zone", () => {
  // Wednesdays at 7:00 Tokyo time — in Europe and in UTC it is still Tuesday
  const series = {
    id: "s",
    recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"],
    start: { dateTime: "2026-11-04T07:00:00+09:00", timeZone: TOKYO },
    end: { dateTime: "2026-11-04T08:00:00+09:00", timeZone: TOKYO },
  };

  it("'this and following' moved to Thursday: weekday follows the event's clock", () => {
    const occurrence = toCalendarEvent("c", {
      id: "s_2",
      recurringEventId: "s",
      originalStartTime: { dateTime: "2026-11-11T07:00:00+09:00", timeZone: TOKYO },
      start: { dateTime: "2026-11-11T07:00:00+09:00", timeZone: TOKYO },
      end: { dateTime: "2026-11-11T08:00:00+09:00", timeZone: TOKYO },
    }) as CalendarEvent;
    const d = applyChange(fromEvent(occurrence, series.recurrence), { startDate: "2026-11-12" });
    expect(followingRecurrence(d, series, 0)).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=TH"]);
  });

  it("UNTIL — end of day in the event's time zone", () => {
    const rule = { freq: "DAILY" as const, interval: 1, days: [], end: { kind: "until" as const, date: "2026-11-20" } };
    const start = new Date(2026, 10, 4, 18);
    const lines = buildRecurrence(rule, [], start, false, "America/Los_Angeles");
    expect(lines).toEqual(["RRULE:FREQ=DAILY;UNTIL=20261121T075959Z"]);
    expect(parseRecurrence(lines, start, "America/Los_Angeles").rule?.end).toEqual({ kind: "until", date: "2026-11-20" });
  });
});
