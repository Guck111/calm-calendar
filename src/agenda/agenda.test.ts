import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "../shared/api/types";
import { agendaDays, isNow, isPast } from "./agenda";

const now = new Date(2026, 10, 4, 12, 0);
const ev = (title: string, start: Date, end: Date, allDay = false): CalendarEvent => ({
  key: title,
  id: title,
  calendarId: "c",
  title,
  start,
  end,
  allDay,
  recurring: false,
});
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m);

describe("agendaDays", () => {
  const events = [
    ev("Lunch", at(4, 13), at(4, 14)),
    ev("Standup", at(4, 9, 30), at(4, 9, 45)),
    ev("Trip", at(4, 0), at(6, 0), true),
    ev("Dentist", at(5, 10), at(5, 11)),
    ev("Next week", at(11, 10), at(11, 11)),
  ];

  it("today and tomorrow, all-day first, then by time", () => {
    const [today, tomorrow] = agendaDays(events, now);
    expect(today.day).toEqual(at(4, 0));
    expect(today.events.map((e) => e.title)).toEqual(["Trip", "Standup", "Lunch"]);
    expect(tomorrow.events.map((e) => e.title)).toEqual(["Trip", "Dentist"]);
  });

  it("an event crossing midnight shows on both days", () => {
    const late = ev("Party", at(4, 22), at(5, 2));
    const [today, tomorrow] = agendaDays([late], now);
    expect(today.events).toHaveLength(1);
    expect(tomorrow.events).toHaveLength(1);
  });
});

describe("isPast and isNow", () => {
  it("tell finished and ongoing timed events apart", () => {
    expect(isPast(ev("a", at(4, 9), at(4, 10)), now)).toBe(true);
    expect(isNow(ev("b", at(4, 11), at(4, 13)), now)).toBe(true);
    expect(isPast(ev("c", at(4, 0), at(5, 0), true), now)).toBe(false);
  });
});
