import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "../api/types";
import { eventsForDay, isAllDayLike, layoutDay, overlapsDay } from "./layout";

const ev = (id: string, start: Date, end: Date, allDay = false): CalendarEvent => ({
  key: id, id, calendarId: "c", account: "", title: id, start, end, allDay, recurring: false,
});
const at = (h: number, m = 0, day = 4, s = 0, ms = 0) => new Date(2026, 10, day, h, m, s, ms);
const day = new Date(2026, 10, 4);

describe("which day an event belongs to", () => {
  it("a zero-length event belongs only to the day it is on", () => {
    expect(overlapsDay(ev("late", at(23, 0, 3), at(23, 0, 3)), day)).toBe(false);
    expect(overlapsDay(ev("next", at(0, 0, 5), at(0, 0, 5)), day)).toBe(false);
    expect(overlapsDay(ev("midnight", at(0), at(0)), day)).toBe(true);
  });

  it("an event of exactly 24 hours goes to the all-day strip", () => {
    expect(isAllDayLike(ev("day", at(9), at(9, 0, 5)))).toBe(true);
    expect(isAllDayLike(ev("almost", at(9), at(8, 59, 5)))).toBe(false);
  });

  it("the day list: all-day first, then by start, longer first, then by title", () => {
    const events = [
      ev("b", at(10), at(11)),
      ev("a", at(10), at(11)),
      ev("long", at(10), at(12)),
      ev("early", at(9), at(10)),
      ev("all", at(0), at(0, 0, 5), true),
    ];
    expect(eventsForDay(events, day).map((e) => e.id)).toEqual(["all", "early", "long", "a", "b"]);
  });
});

describe("time grid edge cases", () => {
  it("seconds round the position to the nearest minute, and the latest start stays inside the day", () => {
    const [placed] = layoutDay([ev("s", at(10, 0, 4, 30, 600), at(11))], day);
    expect(placed.startMin).toBe(601);
    const [last] = layoutDay([ev("last", at(23, 59, 4, 50), at(23, 59, 4, 59))], day);
    expect(last.startMin).toBe(1439);
  });

  it("events starting together: the longer one takes the first column, whatever the input order", () => {
    const placed = layoutDay([ev("short", at(10), at(11)), ev("long", at(10), at(12))], day);
    expect(placed.map((p) => [p.event.id, p.column])).toEqual([["long", 0], ["short", 1]]);
  });

  it("an event starting right when a group ends begins a new group with its own width", () => {
    const placed = layoutDay([ev("a", at(10), at(11)), ev("b", at(10), at(11)), ev("c", at(11), at(12))], day);
    expect(placed.map((p) => [p.event.id, p.columns])).toEqual([["a", 2], ["b", 2], ["c", 1]]);
  });
});
