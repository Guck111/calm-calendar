import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "../i18n";
import {
  WallClockDate,
  formatClock,
  formatDayMonth,
  formatDayNumber,
  formatFullDate,
  formatMonthShort,
  formatMonthYear,
  formatShortDate,
  formatSpan,
  formatTime,
  formatWeekNumber,
  formatWeekdayLong,
  formatWeekdayShort,
  isSameDay,
  isSameMonth,
  shiftCursor,
  toDateKey,
  viewDays,
  viewTitle,
  weekdayLabels,
} from "./date";

afterEach(() => setLang("ru"));

// Wednesday, November 4, 2026, 9:30
const wed = new Date(2026, 10, 4, 9, 30);
const plain = (s: string) => s.replace(/[   ]/g, " ");

describe("same day and month", () => {
  it("compares the year, the month and the day", () => {
    expect(isSameDay(wed, new Date(2027, 10, 4))).toBe(false);
    expect(isSameDay(wed, new Date(2026, 9, 4))).toBe(false);
    expect(isSameDay(wed, new Date(2026, 10, 4, 23))).toBe(true);
    expect(isSameMonth(wed, new Date(2027, 10, 1))).toBe(false);
    expect(isSameMonth(wed, new Date(2026, 9, 4))).toBe(false);
  });
});

describe("views", () => {
  it("the month view shows six weeks", () => {
    expect(viewDays("month", wed)).toHaveLength(42);
  });

  it("paging back moves by a month, a week, a day or the schedule length", () => {
    expect((["month", "week", "day", "agenda"] as const).map((view) => toDateKey(shiftCursor(view, wed, -1))))
      .toEqual(["2026-10-04", "2026-10-28", "2026-11-03", "2026-10-07"]);
  });

  it("month and day titles name the month or the whole date", () => {
    expect(viewTitle("month", wed)).toBe("Ноябрь 2026");
    expect(viewTitle("day", wed)).toBe("Среда, 4 ноября 2026");
  });
});

describe("numbers in the language's digits", () => {
  it("day and week numbers follow the current language", () => {
    setLang("ar");
    expect(formatWeekNumber(new Date(2026, 10, 2))).toBe("٤٥");
    expect(formatDayNumber(wed)).toBe("٤");
    setLang("en", "en-GB");
    expect(formatDayNumber(wed)).toBe("4");
    expect(formatWeekNumber(new Date(2026, 10, 2))).toBe("45");
  });
});

describe("date and time labels", () => {
  it("month, weekday and date labels in Russian", () => {
    expect(formatMonthYear(wed)).toBe("Ноябрь 2026");
    expect(formatMonthShort(wed)).toBe("нояб.");
    expect(formatWeekdayShort(wed)).toBe("ср");
    expect(formatWeekdayLong(wed)).toBe("Среда");
    expect(formatDayMonth(wed)).toBe("4 ноября");
    expect(formatFullDate(wed)).toBe("Среда, 4 ноября 2026");
  });

  it("a short date has the weekday this year and the year otherwise", () => {
    expect(plain(formatShortDate(wed, new Date(2026, 0, 1)))).toBe("ср, 4 нояб.");
    expect(plain(formatShortDate(wed, new Date(2027, 0, 1)))).toBe("4 нояб. 2026");
  });

  it("the clock keeps AM and PM apart in 12-hour regions", () => {
    expect(formatClock(wed)).toEqual({ time: "09:30", period: "" });
    setLang("en", "en-US");
    expect(formatClock(wed)).toEqual({ time: "9:30", period: "AM" });
  });

  it("wall clock dates are formatted as written, whatever the system time zone", () => {
    const wall = new WallClockDate(Date.UTC(2026, 10, 4, 9, 30));
    expect(formatTime(wall)).toBe("09:30");
    expect(wall.getTimezoneOffset()).toBe(0);
  });

  it("weekday labels: short by default, narrow on request, but never narrow in Slavic languages", () => {
    setLang("en", "en-GB");
    expect(weekdayLabels()).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(weekdayLabels("narrow")).toEqual(["M", "T", "W", "T", "F", "S", "S"]);
    setLang("ru");
    expect(weekdayLabels("narrow")).toEqual(["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]);
  });

  it("a span in hours and minutes", () => {
    expect(formatSpan(90)).toBe("1 ч 30 мин");
    expect(formatSpan(45)).toBe("45 мин");
  });
});
