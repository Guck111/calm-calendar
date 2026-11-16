// Time zones on Intl, no libraries: conversion between an instant and a wall clock in a time zone,
// offset from UTC and labels for lists.
import { locale } from "../i18n";
import { localTimeZone, WallClockDate } from "./date";

const DAY = 86_400_000;

const partsCache = new Map<string, Intl.DateTimeFormat>();
const partsFormat = (zone: string): Intl.DateTimeFormat => {
  let f = partsCache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    partsCache.set(zone, f);
  }
  return f;
};

type Wall = { y: number; mo: number; d: number; h: number; mi: number; s: number };

const wallParts = (instant: Date, zone: string): Wall => {
  const get = (type: string, parts: Intl.DateTimeFormatPart[]) => Number(parts.find((p) => p.type === type)?.value);
  const parts = partsFormat(zone).formatToParts(instant);
  return {
    y: get("year", parts),
    mo: get("month", parts),
    d: get("day", parts),
    h: get("hour", parts) % 24,
    mi: get("minute", parts),
    s: get("second", parts),
  };
};

/** Time zone offset from UTC in minutes at this instant: +180 for Moscow, −300 for New York in winter */
export const zoneOffset = (zone: string, instant: Date): number => {
  const w = wallParts(instant, zone);
  const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
};

/** The instant when the time zone's clock shows this date and time. Nonexistent time (switch to summer time)
 *  is shifted forward, and doubled time takes the first one unless the original instant specifies the choice. */
export const fromZonedParts = (
  y: number, mo: number, d: number, h: number, mi: number, s: number, zone: string, original?: number,
): Date => {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  if (!Number.isFinite(guess)) return new Date(NaN);
  // offset a day before and after: there is never more than one transition per day
  const before = zoneOffset(zone, new Date(guess - DAY));
  const after = zoneOffset(zone, new Date(guess + DAY));
  const fits = (t: number) => zoneOffset(zone, new Date(t)) * 60_000 === guess - t;
  const found = [guess - before * 60_000, guess - after * 60_000].filter(fits);
  if (original !== undefined && found.includes(original)) return new Date(original);
  // the time doesn't exist on the clock — use the offset before the transition, which is the forward shift
  return new Date(found.length ? Math.min(...found) : guess - before * 60_000);
};

/** "2026-11-04" and "09:30" by the time zone clock → instant */
export const fromZoned = (dateKey: string, timeKey: string, zone: string, original?: Date): Date => {
  const [y, mo, d] = dateKey.split("-").map(Number);
  const [h, mi] = timeKey.split(":").map(Number);
  // The form stores whole minutes. The original instant is chosen only among matching variants.
  const originalMinute = original && Math.floor(original.getTime() / 60_000) * 60_000;
  return fromZonedParts(y, mo, d, h || 0, mi || 0, 0, zone, originalMinute);
};

/** The same year, month, day and wall clock time as in the zone (for the form and recurrence rules). */
export const wallClock = (instant: Date, zone: string): Date => {
  const w = wallParts(instant, zone);
  return new WallClockDate(Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s));
};

/** Back: a local date as the time zone clock → instant */
export const fromWallClock = (wall: Date, zone: string): Date =>
  fromZonedParts(
    wall.getFullYear(),
    wall.getMonth() + 1,
    wall.getDate(),
    wall.getHours(),
    wall.getMinutes(),
    wall.getSeconds(),
    zone,
  );

let zonesCache: string[] | null = null;
/** All time zones Intl knows; the system one and UTC are added if they are not in the list */
export const allTimeZones = (): string[] => {
  if (!zonesCache) {
    const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
    zonesCache = [...new Set([...supported, "UTC", localTimeZone()])];
  }
  return zonesCache;
};

export const isTimeZone = (zone: unknown): zone is string => {
  if (typeof zone !== "string" || !zone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

const nameCache = new Map<string, string>();
const zoneName = (zone: string, style: "longGeneric" | "shortOffset" | "short", at: Date): string => {
  const key = `${locale}|${zone}|${style}`;
  if (style === "longGeneric" && nameCache.has(key)) return nameCache.get(key) as string;
  let name = "";
  try {
    name =
      new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: style })
        .formatToParts(at)
        .find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    name = "";
  }
  if (style === "longGeneric") nameCache.set(key, name);
  return name;
};

/** «GMT+03:00», «GMT−05:30», «GMT» */
export const formatOffset = (minutes: number): string => {
  if (minutes === 0) return "GMT";
  const sign = minutes > 0 ? "+" : "−";
  const abs = Math.abs(minutes);
  return `GMT${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
};

/** city from a time zone id: "America/Argentina/Buenos_Aires" → "Buenos Aires" */
export const zoneCity = (zone: string): string => zone.slice(zone.lastIndexOf("/") + 1).replaceAll("_", " ");

/** Label for the list: «(GMT+03:00) Москва, стандартное время — Moscow». The time zone name is in the UI language */
export const zoneLabel = (zone: string, at = new Date()): string => {
  const offset = formatOffset(zoneOffset(zone, at));
  const name = zoneName(zone, "longGeneric", at);
  const city = zoneCity(zone);
  if (zone === "UTC") return `(${offset}) UTC`;
  return name && !name.startsWith("GMT") ? `(${offset}) ${name} — ${city}` : `(${offset}) ${city}`;
};

/** Short name above the hours column: "MSK", "PST", "GMT+9" */
export const zoneShort = (zone: string, at = new Date()): string => {
  const short = zoneName(zone, "short", at);
  return short || formatOffset(zoneOffset(zone, at));
};

/** Time in the second time zone on each hour line of this day's grid: "9:00 here" → hours and minutes there.
 *  Minutes are nonzero for time zones like India (+5:30) */
export const zoneHours = (day: Date, zone: string): { hour: number; minute: number }[] =>
  Array.from({ length: 24 }, (_, h) => {
    const wall = wallClock(new Date(day.getFullYear(), day.getMonth(), day.getDate(), h), zone);
    return { hour: wall.getHours(), minute: wall.getMinutes() };
  });

/** Time zones for the list, sorted by offset, then by city */
export const sortedTimeZones = (at = new Date()): { zone: string; offset: number }[] =>
  allTimeZones()
    .map((zone) => ({ zone, offset: zoneOffset(zone, at) }))
    .sort((a, b) => a.offset - b.offset || zoneCity(a.zone).localeCompare(zoneCity(b.zone)));
