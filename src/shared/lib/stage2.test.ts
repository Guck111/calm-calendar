import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "../api/types";
import { setLang } from "../i18n";
import { AGENDA_DAYS, isoWeek, shiftCursor, viewDays, viewRange, weekNumberOf } from "./date";
import { formatFreeSlots, freeSlots, type FreeOptions } from "./free";
import {
  HOLIDAY_REGIONS,
  holidayCalendar,
  holidayCalendarId,
  isHolidayRegion,
  regionName,
  sortedRegions,
} from "./holidays";
import { mergeSharedMeetings } from "./shared-meetings";

const ev = (key: string, account: string, from: number, to: number, over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  key,
  id: key,
  calendarId: `${account}\u0000primary`,
  account,
  title: key,
  start: new Date(2026, 10, 9, from),
  end: new Date(2026, 10, 9, to),
  allDay: false,
  recurring: false,
  ...over,
});

describe("week numbers", () => {
  it("ISO 8601: week from Monday, the first one contains the first Thursday", () => {
    expect(isoWeek(new Date(2026, 10, 9))).toBe(46);
    expect(isoWeek(new Date(2026, 0, 1))).toBe(1); // Thursday
    expect(isoWeek(new Date(2027, 0, 1))).toBe(53); // Friday: still week 53 of 2026
    expect(isoWeek(new Date(2025, 11, 29))).toBe(1); // Monday of the first week of 2026
    expect(isoWeek(new Date(2026, 11, 31))).toBe(53);
  });

  it("a row starting on Sunday or Monday gets one number", () => {
    expect(weekNumberOf(new Date(2026, 10, 8))).toBe(46); // Sunday
    expect(weekNumberOf(new Date(2026, 10, 9))).toBe(46); // Monday
  });
});

describe("'Schedule' view", () => {
  it("four weeks from the selected day and paging by the same amount", () => {
    const cursor = new Date(2026, 10, 11);
    const days = viewDays("agenda", cursor);
    expect(days).toHaveLength(AGENDA_DAYS);
    expect(days[0]).toEqual(new Date(2026, 10, 11));
    expect(viewRange("agenda", cursor).end).toEqual(new Date(2026, 11, 9));
    expect(shiftCursor("agenda", cursor, 1)).toEqual(new Date(2026, 11, 9));
  });
});

describe("free time", () => {
  const o: FreeOptions = { from: 9 * 60, to: 18 * 60, minLength: 30, weekends: false };
  const monday = new Date(2026, 10, 9);
  const early = new Date(2026, 10, 9, 7);

  it("gaps between events during working hours; 'free', all-day and short gaps don't get in the way", () => {
    const events = [
      ev("a", "me", 10, 11),
      ev("b", "work", 10, 12), // overlaps a
      ev("c", "me", 12, 12, { end: new Date(2026, 10, 9, 12, 20) }), // gap 12:00–12:00 — empty, after it — 12:20
      ev("d", "me", 13, 14, { free: true }),
      ev("e", "me", 0, 0, { allDay: true, end: new Date(2026, 10, 10) }),
      ev("f", "me", 17, 17, { start: new Date(2026, 10, 9, 17, 40), end: new Date(2026, 10, 9, 19) }),
    ];
    const [day] = freeSlots(events, [monday], o, early);
    expect(day.slots.map((s) => [s.start.getHours() * 60 + s.start.getMinutes(), s.end.getHours() * 60 + s.end.getMinutes()])).toEqual([
      [9 * 60, 10 * 60],
      [12 * 60 + 20, 17 * 60 + 40],
    ]);
  });

  it("today — only from the current moment rounded to a quarter hour; past days and weekends are skipped", () => {
    const now = new Date(2026, 10, 10, 15, 7);
    const days = [9, 10, 14, 15].map((d) => new Date(2026, 10, d)); // Mon, Tue, Sat, Sun
    const result = freeSlots([], days, o, now);
    expect(result.map((d) => d.day.getDate())).toEqual([10]);
    expect(result[0].slots[0].start).toEqual(new Date(2026, 10, 10, 15, 15));
    expect(freeSlots([], days, { ...o, weekends: true }, now).map((d) => d.day.getDate())).toEqual([10, 14, 15]);
  });

  it("text for a messenger", () => {
    setLang("ru", "ru-RU");
    const text = formatFreeSlots(freeSlots([ev("a", "me", 10, 11)], [monday], o, early), early, "Europe/Warsaw");
    expect(text.split("\n")).toEqual(["Когда я свободен (Warsaw, GMT+1):", "Пн, 9 ноября: 09:00–10:00 и 11:00–18:00"]);
    expect(formatFreeSlots([], early)).toBe("Свободного времени нет");
  });
});

describe("one meeting in two accounts", () => {
  const calId = (a: string) => `${a}\u0000primary`;

  it("shown once, the editable copy remains", () => {
    const events = [
      ev("me-copy", "me", 9, 10, { iCalUID: "x" }),
      ev("work-copy", "work", 9, 10, { iCalUID: "x" }),
      ev("other", "me", 11, 12),
    ];
    const merged = mergeSharedMeetings(events, new Set([calId("work")]));
    expect(merged.map((e) => e.key)).toEqual(["work-copy", "other"]);
    expect(merged[0].alsoIn).toEqual([calId("me")]);
  });

  it("series occurrences and copies in one account are not merged", () => {
    const events = [
      ev("mon", "me", 9, 10, { iCalUID: "s" }),
      ev("tue", "me", 9, 10, { iCalUID: "s", start: new Date(2026, 10, 10, 9), end: new Date(2026, 10, 10, 10) }),
      ev("same-account", "me", 9, 10, { iCalUID: "s", calendarId: "me\u0000team" }),
    ];
    expect(mergeSharedMeetings(events, new Set())).toBe(events);
  });
});

describe("holidays", () => {
  it("Google calendar id with the naming language", () => {
    expect(holidayCalendarId("PL", "ru")).toBe("ru.polish#holiday@group.v.calendar.google.com");
    expect(holidayCalendarId("BD", "bn")).toBe("bn.bd#holiday@group.v.calendar.google.com");
    expect(isHolidayRegion("US")).toBe(true);
    expect(isHolidayRegion("XX")).toBe(false);
    expect(isHolidayRegion(null)).toBe(false);
  });

  it("countries in the language's alphabetical order", () => {
    setLang("ru", "ru-RU");
    expect(regionName("PL")).toBe("Польша");
    const names = sortedRegions().map((r) => r.name);
    expect(names).toHaveLength(Object.keys(HOLIDAY_REGIONS).length);
    expect([...names].sort((a, b) => a.localeCompare(b, "ru"))).toEqual(names);
  });

  it("holiday calendar for the main window and widget: via the first account, without duplicates", () => {
    setLang("ru", "ru-RU");
    const cal = holidayCalendar("PL", ["me@example.com", "work@example.com"], []);
    expect(cal).toMatchObject({
      googleId: "ru.polish#holiday@group.v.calendar.google.com",
      account: "me@example.com",
      name: "Польша",
      accessRole: "reader",
      holiday: true,
    });
    // such a calendar is already in Google, in any naming language
    const google = [{ ...cal!, googleId: "en.polish#holiday@group.v.calendar.google.com", holiday: undefined }];
    expect(holidayCalendar("PL", ["me@example.com"], google)).toBeNull();
    expect(holidayCalendar(null, ["me@example.com"], [])).toBeNull();
    expect(holidayCalendar("PL", [], [])).toBeNull();
    expect(holidayCalendar("XX", ["me@example.com"], [])).toBeNull();
  });
});
