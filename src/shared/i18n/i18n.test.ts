import { afterEach, describe, expect, it } from "vitest";
import { buildReminders } from "../../model/reminders";
import { countdown } from "../../widget/countdown";
import type { CalendarEvent } from "../api/types";
import { formatHour, formatTime, startOfWeek, toDateKey, viewTitle, weekdayLabels } from "../lib/date";
import { en } from "./en";
import { setLang, t } from "./index";
import { ru } from "./ru";

const event = (over: Partial<CalendarEvent>): CalendarEvent => ({
  key: "c\u0000e",
  id: "e",
  calendarId: "c",
  title: "Gym",
  start: new Date(2026, 10, 4, 19, 0),
  end: new Date(2026, 10, 4, 20, 0),
  allDay: false,
  recurring: false,
  ...over,
});

afterEach(() => setLang("ru"));

// Intl ставит узкие пробелы (U+2009, U+202F) вокруг тире и перед AM: сравниваем с обычными
const plain = (s: string) => s.replace(/[\u2009\u202f]/g, " ");

describe("dictionaries", () => {
  // одинаковые ключи на любой глубине: английский не может отстать от русского незаметно
  const keys = (o: object, prefix = ""): string[] =>
    Object.entries(o).flatMap(([k, v]) =>
      v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}:${typeof v}`],
    );

  it("have the same keys and value kinds", () => {
    expect(keys(en).sort()).toEqual(keys(ru).sort());
  });
});

describe("English, US region", () => {
  it("starts the week on Sunday", () => {
    setLang("en", "en-US");
    expect(toDateKey(startOfWeek(new Date(2026, 10, 4)))).toBe("2026-11-01");
    expect(weekdayLabels("narrow")).toEqual(["S", "M", "T", "W", "T", "F", "S"]);
  });

  it("formats week titles, times and hours", () => {
    setLang("en", "en-US");
    expect(plain(viewTitle("week", new Date(2026, 10, 4)))).toBe("November 1 – 7, 2026");
    expect(plain(formatTime(new Date(2026, 0, 1, 9, 5)))).toBe("9:05 AM");
    expect(plain(formatHour(15))).toBe("3 PM");
  });

  it("writes the widget countdown and reminders in English", () => {
    setLang("en", "en-US");
    const now = new Date(2026, 10, 4, 18, 35);
    expect(countdown([event({})], now)).toEqual({ title: "Gym", text: "in 25 min" });
    const later = event({ start: new Date(2026, 10, 4, 20, 5), end: new Date(2026, 10, 4, 21, 0), reminders: [90] });
    const [r] = buildReminders([later], [], now);
    expect(plain(r.body)).toBe("In 1 h 30 min · 8:05 PM–9:00 PM");
    expect(r.privateTitle).toBe("Event");
  });
});

describe("English, British region", () => {
  it("keeps Monday and 24-hour time", () => {
    setLang("en", "en-GB");
    expect(toDateKey(startOfWeek(new Date(2026, 10, 4)))).toBe("2026-11-02");
    expect(formatTime(new Date(2026, 0, 1, 9, 5))).toBe("09:05");
    expect(formatHour(15)).toBe("15:00");
    expect(t.common.today).toBe("Today");
  });
});

describe("Russian", () => {
  it("is the default in tests and keeps Monday", () => {
    expect(t.common.today).toBe("Сегодня");
    expect(weekdayLabels()).toEqual(["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]);
    expect(plain(viewTitle("week", new Date(2026, 10, 30)))).toBe("30 ноября – 6 декабря 2026");
  });
});
