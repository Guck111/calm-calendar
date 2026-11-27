import { describe, expect, it } from "vitest";
import { assemble, cleanTitle, cutter, nextWeekday, normalizeInput, takeTags, upcomingDate, validTime } from "./quick-core";
import { toDateKey } from "./date";

// Wednesday, November 4, 2026
const wed = new Date(2026, 10, 4, 10, 0);
const midnight = new Date(2026, 10, 4);

describe("quick add building blocks", () => {
  it("dashes and commas of other scripts become ordinary ones", () => {
    expect(normalizeInput("1－2～3〜4،5٫6")).toBe("1-2-3-4,5,6");
  });

  it("a time is valid from 0:00 to 23:59", () => {
    expect([validTime(0, 0), validTime(23, 59)]).toEqual([true, true]);
    expect([validTime(24, 0), validTime(-1, 0), validTime(0, 60), validTime(0, -1)]).toEqual([false, false, false, false]);
  });

  it("the nearest weekday is today unless 'next' skips it", () => {
    expect(toDateKey(nextWeekday(wed, 2))).toBe("2026-11-04");
    expect(toDateKey(nextWeekday(wed, 2, true))).toBe("2026-11-11");
    expect(toDateKey(nextWeekday(wed, 4, true))).toBe("2026-11-06");
  });

  it("a date without a year is today or later, a date with a year must exist as written", () => {
    expect(upcomingDate(midnight, 10, 4, null)).toEqual(midnight);
    expect(upcomingDate(new Date(2097, 2, 1), 1, 29, null)).toEqual(new Date(2104, 1, 29));
    expect(upcomingDate(wed, 3, 31, 2027).getTime()).toBeNaN();
    expect(upcomingDate(wed, 0, 1, 25).getTime()).toBeNaN();
  });

  it("a calendar tag prefers a name that starts with it, then one that contains it", () => {
    const calendars = [{ id: "home", name: "Homework" }, { id: "work", name: "Work" }];
    const tag = (text: string) => takeTags(cutter(text), calendars).calendarId;
    expect(tag("call #WORK")).toBe("work");
    expect(tag("call #ome")).toBe("home");
    expect(tag("call #nothing")).toBeUndefined();
  });

  it("spaces are collapsed and prepositions at the edges dropped whatever their case", () => {
    expect(cleanTitle("  в  кино  ", "в|на")).toBe("кино");
    expect(cleanTitle("В кино НА", "в|на")).toBe("кино");
    expect(cleanTitle("Ужин   с Олей", "в|на")).toBe("Ужин с Олей");
  });
});

describe("assembling the event", () => {
  const at = (h: number, m: number, endH?: number, endM?: number) =>
    assemble({ title: "x", date: null, time: { h, m, endH, endM }, duration: null }, wed);

  it("a time already passed today is tomorrow, the current minute is still today", () => {
    expect(toDateKey(at(9, 0).start)).toBe("2026-11-05");
    expect(toDateKey(at(10, 0).start)).toBe("2026-11-04");
  });

  it("a range within the hour boundary ends the same day", () => {
    const e = at(10, 50, 11, 10);
    expect([e.start, e.end]).toEqual([new Date(2026, 10, 4, 10, 50), new Date(2026, 10, 4, 11, 10)]);
  });
});
