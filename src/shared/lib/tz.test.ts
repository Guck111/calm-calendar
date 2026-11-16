import { describe, expect, it } from "vitest";
import { toDateKey, toTimeKey } from "./date";
import {
  formatOffset,
  fromWallClock,
  fromZoned,
  isTimeZone,
  sortedTimeZones,
  wallClock,
  zoneCity,
  zoneHours,
  zoneOffset,
} from "./tz";

const iso = (d: Date) => d.toISOString();

describe("time zones", () => {
  it("offset from UTC including daylight saving time", () => {
    expect(zoneOffset("Europe/Moscow", new Date("2026-07-01T12:00:00Z"))).toBe(180);
    expect(zoneOffset("America/New_York", new Date("2026-01-15T12:00:00Z"))).toBe(-300);
    expect(zoneOffset("America/New_York", new Date("2026-07-15T12:00:00Z"))).toBe(-240);
    expect(zoneOffset("Asia/Kolkata", new Date("2026-07-15T12:00:00Z"))).toBe(330);
    expect(zoneOffset("UTC", new Date())).toBe(0);
  });

  it("wall clock in a time zone → instant", () => {
    expect(iso(fromZoned("2026-11-04", "09:30", "Asia/Tokyo"))).toBe("2026-11-04T00:30:00.000Z");
    expect(iso(fromZoned("2026-11-04", "09:30", "America/Los_Angeles"))).toBe("2026-11-04T17:30:00.000Z");
    expect(iso(fromZoned("2026-11-04", "09:30", "Asia/Kathmandu"))).toBe("2026-11-04T03:45:00.000Z");
    // in summer Los Angeles has offset −7
    expect(iso(fromZoned("2026-07-04", "09:30", "America/Los_Angeles"))).toBe("2026-07-04T16:30:00.000Z");
  });

  it("nonexistent time at the switch to summer time is shifted forward", () => {
    // in New York on March 8, 2026 clocks go from 2:00 to 3:00
    const at = fromZoned("2026-03-08", "02:30", "America/New_York");
    expect(iso(at)).toBe("2026-03-08T07:30:00.000Z");
    expect(toTimeKey(wallClock(at, "America/New_York"))).toBe("03:30");
  });

  it("doubled time at the switch to winter time — the first of the two", () => {
    // in New York on November 1, 2026 the hour from 1:00 to 2:00 happens twice
    expect(iso(fromZoned("2026-11-01", "01:30", "America/New_York"))).toBe("2026-11-01T05:30:00.000Z");
  });

  it("time zone clock and back", () => {
    const at = new Date("2026-11-04T23:30:00Z");
    const tokyo = wallClock(at, "Asia/Tokyo");
    expect(toDateKey(tokyo)).toBe("2026-11-05");
    expect(toTimeKey(tokyo)).toBe("08:30");
    expect(iso(fromWallClock(tokyo, "Asia/Tokyo"))).toBe(iso(at));
    const la = wallClock(at, "America/Los_Angeles");
    expect(`${toDateKey(la)} ${toTimeKey(la)}`).toBe("2026-11-04 15:30");
    expect(iso(fromWallClock(la, "America/Los_Angeles"))).toBe(iso(at));
  });

  it("second time zone hours on the grid lines go consecutively with an offset", () => {
    const day = new Date(2026, 10, 4);
    const at = (h: number) => new Date(2026, 10, 4, h);
    const tokyo = zoneHours(day, "Asia/Tokyo");
    expect(tokyo).toHaveLength(24);
    tokyo.forEach((x, h) => expect(x).toEqual({ hour: wallClock(at(h), "Asia/Tokyo").getHours(), minute: 0 }));
    expect(new Set(tokyo.map((x) => x.hour)).size).toBe(24);
    // India has a half hour: minutes 30 on every line, unless the system is in the same kind of time zone
    const india = zoneHours(day, "Asia/Kolkata");
    const own = zoneOffset("Asia/Kolkata", at(12)) - -at(12).getTimezoneOffset();
    expect(india.every((x) => x.minute === ((own % 60) + 60) % 60)).toBe(true);
  });

  it("labels", () => {
    expect(formatOffset(180)).toBe("GMT+03:00");
    expect(formatOffset(-330)).toBe("GMT−05:30");
    expect(formatOffset(0)).toBe("GMT");
    expect(zoneCity("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
  });

  it("time zone list sorted by offset and time zone validation", () => {
    const list = sortedTimeZones(new Date("2026-01-15T12:00:00Z"));
    expect(list.length).toBeGreaterThan(300);
    expect(list.some((z) => z.zone === "Europe/Moscow")).toBe(true);
    for (let i = 1; i < list.length; i++) expect(list[i].offset).toBeGreaterThanOrEqual(list[i - 1].offset);
    expect(isTimeZone("Asia/Tokyo")).toBe(true);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
    expect(isTimeZone("")).toBe(false);
  });
});
