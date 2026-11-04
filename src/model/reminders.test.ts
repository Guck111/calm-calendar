import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "../shared/api/types";
import { buildReminders } from "./reminders";

const now = new Date(2026, 10, 4, 18, 0);
const ev = (over: Partial<CalendarEvent>): CalendarEvent => ({
  key: "c\u0000e",
  id: "e",
  calendarId: "c",
  title: "Урок",
  start: new Date(2026, 10, 4, 19, 0),
  end: new Date(2026, 10, 4, 19, 50),
  allDay: false,
  recurring: false,
  reminders: "default",
  ...over,
});
const calendars = [{ id: "c", defaultReminders: [10, 30] }];

describe("напоминания", () => {
  it("по умолчанию берутся из календаря", () => {
    const list = buildReminders([ev({})], calendars, now);
    expect(list.map((r) => r.at)).toEqual([
      new Date(2026, 10, 4, 18, 50).getTime(),
      new Date(2026, 10, 4, 18, 30).getTime(),
    ]);
    expect(list[0]).toMatchObject({ title: "Урок", body: "Через 10 мин · 19:00–19:50" });
  });

  it("свои напоминания события заменяют настройки календаря", () => {
    const list = buildReminders([ev({ reminders: [0] })], calendars, now);
    expect(list).toHaveLength(1);
    expect(list[0].body).toBe("Начинается сейчас · 19:00–19:50");
  });

  it("прошедшие и слишком далёкие не попадают", () => {
    expect(buildReminders([ev({ reminders: [90] })], calendars, now)).toHaveLength(0);
    const far = ev({ start: new Date(2026, 10, 10, 9), end: new Date(2026, 10, 10, 10) });
    expect(buildReminders([far], calendars, now)).toHaveLength(0);
  });

  it("событие на весь день без явных напоминаний не напоминает", () => {
    const allDay = ev({ allDay: true, start: new Date(2026, 10, 5), end: new Date(2026, 10, 6) });
    expect(buildReminders([allDay], calendars, now)).toHaveLength(0);
    expect(buildReminders([{ ...allDay, reminders: [5 * 60] }], calendars, now)[0].body).toBe("Через 5 ч · Весь день");
  });

  it("у повторений разные ключи, чтобы каждое показалось", () => {
    const a = ev({ reminders: [10] });
    const b = ev({ reminders: [10], start: new Date(2026, 10, 5, 19), end: new Date(2026, 10, 5, 20) });
    const keys = buildReminders([a, b], calendars, now).map((r) => r.key);
    expect(new Set(keys).size).toBe(2);
  });
});
