import { describe, expect, it } from "vitest";
import { buildAlerts } from "../model/reminders";
import type { CalendarEvent } from "../shared/api/types";
import { alertStatus } from "./AlertWindow";

const now = new Date(2026, 10, 4, 18, 0);
const ev = (over: Partial<CalendarEvent>): CalendarEvent => ({
  key: "c\u0000e",
  id: "e",
  calendarId: "c",
  title: "Созвон",
  start: new Date(2026, 10, 4, 19, 0),
  end: new Date(2026, 10, 4, 19, 30),
  allDay: false,
  recurring: false,
  ...over,
});

describe("buildAlerts", () => {
  it("a minute before the start, with the call link when there is one", () => {
    const meeting = { url: "https://meet.google.com/abc-defg-hij", provider: "Google Meet" };
    const [a] = buildAlerts([ev({ meeting })], now);
    expect(a).toMatchObject({
      title: "Созвон",
      at: new Date(2026, 10, 4, 18, 59).getTime(),
      start: new Date(2026, 10, 4, 19, 0).getTime(),
      url: meeting.url,
      provider: "Google Meet",
    });
    expect(buildAlerts([ev({})], now)[0].url).toBeUndefined();
  });

  it("skips all-day, past and far-away events", () => {
    expect(buildAlerts([ev({ allDay: true })], now)).toEqual([]);
    expect(buildAlerts([ev({ start: new Date(2026, 10, 4, 17, 0) })], now)).toEqual([]);
    expect(buildAlerts([ev({ start: new Date(2026, 10, 8, 19, 0) })], now)).toEqual([]);
  });

  it("gives every occurrence its own key", () => {
    const keys = buildAlerts([ev({}), ev({ start: new Date(2026, 10, 5, 19, 0) })], now).map((a) => a.key);
    expect(new Set(keys).size).toBe(2);
  });
});

describe("alertStatus", () => {
  const start = new Date(2026, 10, 4, 19, 0).getTime();
  const end = new Date(2026, 10, 4, 19, 30).getTime();
  it("counts down, then says it starts, then shows what is left", () => {
    expect(alertStatus({ start, end }, start - 60_000)).toBe("через 1 мин");
    expect(alertStatus({ start, end }, start - 10_000)).toBe("Начинается сейчас");
    expect(alertStatus({ start, end }, start + 5 * 60_000)).toBe("идёт, ещё 25 мин");
  });
});
