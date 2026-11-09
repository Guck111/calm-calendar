import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "../api/types";
import { setLang } from "../i18n";
import { AGENDA_DAYS, isoWeek, shiftCursor, viewDays, viewRange, weekNumberOf } from "./date";
import { formatFreeSlots, freeSlots, type FreeOptions } from "./free";
import { HOLIDAY_REGIONS, holidayCalendarId, isHolidayRegion, regionName, sortedRegions } from "./holidays";
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

describe("номера недель", () => {
  it("ISO 8601: неделя с понедельника, первая — с первым четвергом", () => {
    expect(isoWeek(new Date(2026, 10, 9))).toBe(46);
    expect(isoWeek(new Date(2026, 0, 1))).toBe(1); // четверг
    expect(isoWeek(new Date(2027, 0, 1))).toBe(53); // пятница: ещё 53-я неделя 2026
    expect(isoWeek(new Date(2025, 11, 29))).toBe(1); // понедельник первой недели 2026
    expect(isoWeek(new Date(2026, 11, 31))).toBe(53);
  });

  it("строка, начатая с воскресенья или понедельника, получает один номер", () => {
    expect(weekNumberOf(new Date(2026, 10, 8))).toBe(46); // воскресенье
    expect(weekNumberOf(new Date(2026, 10, 9))).toBe(46); // понедельник
  });
});

describe("вид «Расписание»", () => {
  it("четыре недели с выбранного дня и листание на столько же", () => {
    const cursor = new Date(2026, 10, 11);
    const days = viewDays("agenda", cursor);
    expect(days).toHaveLength(AGENDA_DAYS);
    expect(days[0]).toEqual(new Date(2026, 10, 11));
    expect(viewRange("agenda", cursor).end).toEqual(new Date(2026, 11, 9));
    expect(shiftCursor("agenda", cursor, 1)).toEqual(new Date(2026, 11, 9));
  });
});

describe("свободное время", () => {
  const o: FreeOptions = { from: 9 * 60, to: 18 * 60, minLength: 30, weekends: false };
  const monday = new Date(2026, 10, 9);
  const early = new Date(2026, 10, 9, 7);

  it("окна между событиями в рабочие часы; «свободен», весь день и короткие окна не мешают", () => {
    const events = [
      ev("a", "me", 10, 11),
      ev("b", "work", 10, 12), // пересекается с a
      ev("c", "me", 12, 12, { end: new Date(2026, 10, 9, 12, 20) }), // окно 12:00–12:00 — пусто, после — 12:20
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

  it("сегодня — только с текущего момента, округлённого до четверти часа; прошлые дни и выходные пропускаем", () => {
    const now = new Date(2026, 10, 10, 15, 7);
    const days = [9, 10, 14, 15].map((d) => new Date(2026, 10, d)); // пн, вт, сб, вс
    const result = freeSlots([], days, o, now);
    expect(result.map((d) => d.day.getDate())).toEqual([10]);
    expect(result[0].slots[0].start).toEqual(new Date(2026, 10, 10, 15, 15));
    expect(freeSlots([], days, { ...o, weekends: true }, now).map((d) => d.day.getDate())).toEqual([10, 14, 15]);
  });

  it("текст для мессенджера", () => {
    setLang("ru", "ru-RU");
    const text = formatFreeSlots(freeSlots([ev("a", "me", 10, 11)], [monday], o, early), early, "Europe/Warsaw");
    expect(text.split("\n")).toEqual(["Когда я свободен (Warsaw, GMT+1):", "Пн, 9 ноября: 09:00–10:00 и 11:00–18:00"]);
    expect(formatFreeSlots([], early)).toBe("Свободного времени нет");
  });
});

describe("одна встреча в двух аккаунтах", () => {
  const calId = (a: string) => `${a}\u0000primary`;

  it("показывается один раз, остаётся копия, которую можно править", () => {
    const events = [
      ev("me-copy", "me", 9, 10, { iCalUID: "x" }),
      ev("work-copy", "work", 9, 10, { iCalUID: "x" }),
      ev("other", "me", 11, 12),
    ];
    const merged = mergeSharedMeetings(events, new Set([calId("work")]));
    expect(merged.map((e) => e.key)).toEqual(["work-copy", "other"]);
    expect(merged[0].alsoIn).toEqual([calId("me")]);
  });

  it("повторения серии и копии в одном аккаунте не объединяются", () => {
    const events = [
      ev("mon", "me", 9, 10, { iCalUID: "s" }),
      ev("tue", "me", 9, 10, { iCalUID: "s", start: new Date(2026, 10, 10, 9), end: new Date(2026, 10, 10, 10) }),
      ev("same-account", "me", 9, 10, { iCalUID: "s", calendarId: "me\u0000team" }),
    ];
    expect(mergeSharedMeetings(events, new Set())).toBe(events);
  });
});

describe("праздники", () => {
  it("id календаря Google с языком названий", () => {
    expect(holidayCalendarId("PL", "ru")).toBe("ru.polish#holiday@group.v.calendar.google.com");
    expect(holidayCalendarId("BD", "bn")).toBe("bn.bd#holiday@group.v.calendar.google.com");
    expect(isHolidayRegion("US")).toBe(true);
    expect(isHolidayRegion("XX")).toBe(false);
    expect(isHolidayRegion(null)).toBe(false);
  });

  it("страны по алфавиту языка", () => {
    setLang("ru", "ru-RU");
    expect(regionName("PL")).toBe("Польша");
    const names = sortedRegions().map((r) => r.name);
    expect(names).toHaveLength(Object.keys(HOLIDAY_REGIONS).length);
    expect([...names].sort((a, b) => a.localeCompare(b, "ru"))).toEqual(names);
  });
});
