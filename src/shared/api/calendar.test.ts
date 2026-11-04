import { describe, expect, it } from "vitest";
import { draftToBody, toCalendarEvent } from "./calendar";
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
  recurring: false,
  ...over,
});

describe("события Google", () => {
  it("событие на весь день из Google: конец не включительно", () => {
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

  it("отменённые и пустые события отбрасываются, у безымянного есть заглушка", () => {
    expect(toCalendarEvent("c", { id: "1", status: "cancelled", start: { date: "2026-11-07" } })).toBeNull();
    expect(toCalendarEvent("c", { id: "2" })).toBeNull();
    expect(toCalendarEvent("c", { id: "3", start: { dateTime: "2026-11-04T09:00:00Z" } })?.title).toBe(
      "(без названия)",
    );
  });

  it("черновик со временем превращается в dateTime и обнуляет date", () => {
    const body = draftToBody(draft());
    expect(body.summary).toBe("Встреча");
    expect(body.start).toMatchObject({ date: null, dateTime: new Date(2026, 10, 4, 9).toISOString() });
    expect(body.end).toMatchObject({ dateTime: new Date(2026, 10, 4, 10, 30).toISOString() });
  });

  it("черновик на весь день: последний день в форме включительно, в Google — нет", () => {
    const body = draftToBody(draft({ allDay: true, endDate: "2026-11-05" }));
    expect(body.start).toEqual({ date: "2026-11-04", dateTime: null, timeZone: null });
    expect(body.end).toEqual({ date: "2026-11-06", dateTime: null, timeZone: null });
  });
});
