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

describe("часовые пояса", () => {
  it("смещение от UTC с учётом летнего времени", () => {
    expect(zoneOffset("Europe/Moscow", new Date("2026-07-01T12:00:00Z"))).toBe(180);
    expect(zoneOffset("America/New_York", new Date("2026-01-15T12:00:00Z"))).toBe(-300);
    expect(zoneOffset("America/New_York", new Date("2026-07-15T12:00:00Z"))).toBe(-240);
    expect(zoneOffset("Asia/Kolkata", new Date("2026-07-15T12:00:00Z"))).toBe(330);
    expect(zoneOffset("UTC", new Date())).toBe(0);
  });

  it("часы в поясе → момент времени", () => {
    expect(iso(fromZoned("2026-11-04", "09:30", "Asia/Tokyo"))).toBe("2026-11-04T00:30:00.000Z");
    expect(iso(fromZoned("2026-11-04", "09:30", "America/Los_Angeles"))).toBe("2026-11-04T17:30:00.000Z");
    expect(iso(fromZoned("2026-11-04", "09:30", "Asia/Kathmandu"))).toBe("2026-11-04T03:45:00.000Z");
    // летом в Лос-Анджелесе смещение −7
    expect(iso(fromZoned("2026-07-04", "09:30", "America/Los_Angeles"))).toBe("2026-07-04T16:30:00.000Z");
  });

  it("несуществующее время при переходе на летнее сдвигается вперёд", () => {
    // в Нью-Йорке 8 марта 2026 часы переводят с 2:00 на 3:00
    const at = fromZoned("2026-03-08", "02:30", "America/New_York");
    expect(iso(at)).toBe("2026-03-08T07:30:00.000Z");
    expect(toTimeKey(wallClock(at, "America/New_York"))).toBe("03:30");
  });

  it("двойное время при переходе на зимнее — первое из двух", () => {
    // в Нью-Йорке 1 ноября 2026 час с 1:00 до 2:00 проходит дважды
    expect(iso(fromZoned("2026-11-01", "01:30", "America/New_York"))).toBe("2026-11-01T05:30:00.000Z");
  });

  it("часы пояса и обратно", () => {
    const at = new Date("2026-11-04T23:30:00Z");
    const tokyo = wallClock(at, "Asia/Tokyo");
    expect(toDateKey(tokyo)).toBe("2026-11-05");
    expect(toTimeKey(tokyo)).toBe("08:30");
    expect(iso(fromWallClock(tokyo, "Asia/Tokyo"))).toBe(iso(at));
    const la = wallClock(at, "America/Los_Angeles");
    expect(`${toDateKey(la)} ${toTimeKey(la)}`).toBe("2026-11-04 15:30");
    expect(iso(fromWallClock(la, "America/Los_Angeles"))).toBe(iso(at));
  });

  it("часы второго пояса на линиях сетки идут подряд со смещением", () => {
    const day = new Date(2026, 10, 4);
    const at = (h: number) => new Date(2026, 10, 4, h);
    const tokyo = zoneHours(day, "Asia/Tokyo");
    expect(tokyo).toHaveLength(24);
    tokyo.forEach((x, h) => expect(x).toEqual({ hour: wallClock(at(h), "Asia/Tokyo").getHours(), minute: 0 }));
    expect(new Set(tokyo.map((x) => x.hour)).size).toBe(24);
    // у Индии полчаса: минуты 30 на каждой линии, если система не в таком же поясе
    const india = zoneHours(day, "Asia/Kolkata");
    const own = zoneOffset("Asia/Kolkata", at(12)) - -at(12).getTimezoneOffset();
    expect(india.every((x) => x.minute === ((own % 60) + 60) % 60)).toBe(true);
  });

  it("подписи", () => {
    expect(formatOffset(180)).toBe("GMT+03:00");
    expect(formatOffset(-330)).toBe("GMT−05:30");
    expect(formatOffset(0)).toBe("GMT");
    expect(zoneCity("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
  });

  it("список поясов отсортирован по смещению и проверка пояса", () => {
    const list = sortedTimeZones(new Date("2026-01-15T12:00:00Z"));
    expect(list.length).toBeGreaterThan(300);
    expect(list.some((z) => z.zone === "Europe/Moscow")).toBe(true);
    for (let i = 1; i < list.length; i++) expect(list[i].offset).toBeGreaterThanOrEqual(list[i - 1].offset);
    expect(isTimeZone("Asia/Tokyo")).toBe(true);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
    expect(isTimeZone("")).toBe(false);
  });
});
