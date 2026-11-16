import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "../shared/api/types";
import { buildReminders } from "./reminders";

const now = new Date(2026, 10, 4, 18, 0);
const ev = (over: Partial<CalendarEvent>): CalendarEvent => ({
  key: "c\u0000e",
  id: "e",
  calendarId: "c", account: "",
  title: "Урок",
  start: new Date(2026, 10, 4, 19, 0),
  end: new Date(2026, 10, 4, 19, 50),
  allDay: false,
  recurring: false,
  reminders: "default",
  ...over,
});
const calendars = [{ id: "c", defaultReminders: [10, 30] }];

describe("reminders", () => {
  it("taken from the calendar by default", () => {
    const list = buildReminders([ev({})], calendars, now);
    expect(list.map((r) => r.at)).toEqual([
      new Date(2026, 10, 4, 18, 50).getTime(),
      new Date(2026, 10, 4, 18, 30).getTime(),
    ]);
    expect(list[0]).toMatchObject({ title: "Урок", body: "Через 10 мин · 19:00–19:50" });
    expect(list[0].privateBody).not.toContain("Урок");
  });

  it("a video meeting reminder has a link and a button label", () => {
    const meeting = { url: "https://meet.google.com/abc-defg-hij", provider: "Google Meet" };
    const [r] = buildReminders([ev({ meeting, reminders: [5] })], calendars, now);
    expect(r).toMatchObject({ url: meeting.url, joinLabel: "Подключиться" });
    expect(buildReminders([ev({ reminders: [5] })], calendars, now)[0].url).toBeUndefined();
  });

  it("the event's own reminders replace the calendar settings", () => {
    const list = buildReminders([ev({ reminders: [0] })], calendars, now);
    expect(list).toHaveLength(1);
    expect(list[0].body).toBe("Начинается сейчас · 19:00–19:50");
  });

  it("past and too distant ones are excluded", () => {
    expect(buildReminders([ev({ reminders: [90] })], calendars, now)).toHaveLength(0);
    const far = ev({ start: new Date(2026, 10, 10, 9), end: new Date(2026, 10, 10, 10) });
    expect(buildReminders([far], calendars, now)).toHaveLength(0);
  });

  it("an all-day event without explicit reminders doesn't remind", () => {
    const allDay = ev({ allDay: true, start: new Date(2026, 10, 5), end: new Date(2026, 10, 6) });
    expect(buildReminders([allDay], calendars, now)).toHaveLength(0);
    expect(buildReminders([{ ...allDay, reminders: [5 * 60] }], calendars, now)[0].body).toBe("Через 5 ч · Весь день");
  });

  it("occurrences have different keys so each one is shown", () => {
    const a = ev({ reminders: [10] });
    const b = ev({ reminders: [10], start: new Date(2026, 10, 5, 19), end: new Date(2026, 10, 5, 20) });
    const keys = buildReminders([a, b], calendars, now).map((r) => r.key);
    expect(new Set(keys).size).toBe(2);
  });
});
