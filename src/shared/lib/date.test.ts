import { describe, expect, it } from "vitest";
import {
  addMonths,
  combineDateTime,
  monthGrid,
  shiftCursor,
  startOfWeek,
  toDateKey,
  viewRange,
  viewTitle,
} from "./date";

describe("dates", () => {
  it("the week starts on Monday, including from Sunday", () => {
    expect(toDateKey(startOfWeek(new Date(2026, 10, 8)))).toBe("2026-11-02");
    expect(toDateKey(startOfWeek(new Date(2026, 10, 2)))).toBe("2026-11-02");
  });

  it("month grid is 42 days from Monday and contains the whole month", () => {
    const grid = monthGrid(new Date(2026, 10, 15));
    expect(grid).toHaveLength(42);
    expect(toDateKey(grid[0])).toBe("2026-10-26");
    expect(grid.some((d) => toDateKey(d) === "2026-11-30")).toBe(true);
  });

  it("paging months doesn't skip over a short month", () => {
    expect(toDateKey(addMonths(new Date(2026, 0, 31), 1))).toBe("2026-02-28");
    expect(toDateKey(shiftCursor("month", new Date(2026, 2, 31), -1))).toBe("2026-02-28");
  });

  it("the week range is 7 full days", () => {
    const r = viewRange("week", new Date(2026, 10, 4, 15, 0));
    expect(toDateKey(r.start)).toBe("2026-11-02");
    expect(toDateKey(r.end)).toBe("2026-11-09");
    expect(r.start.getHours()).toBe(0);
  });

  it("days stay calendar days across the switch to winter time", () => {
    // in Europe the switch to winter time is on October 25, 2026
    const r = viewRange("day", new Date(2026, 9, 25, 12));
    expect(toDateKey(r.end)).toBe("2026-10-26");
    expect(r.end.getHours()).toBe(0);
  });

  it("date and time from form fields are combined in local time", () => {
    const d = combineDateTime("2026-11-04", "18:30");
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([
      2026, 10, 4, 18, 30,
    ]);
  });

  it("week title within one month", () => {
    expect(viewTitle("week", new Date(2026, 10, 4))).toBe("2–8 ноября 2026");
  });
});
