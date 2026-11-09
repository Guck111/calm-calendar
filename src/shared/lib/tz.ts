// Часовые пояса на Intl, без библиотек: перевод между моментом времени и часами в поясе,
// смещение от UTC и подписи для списков.
import { locale } from "../i18n";
import { localTimeZone } from "./date";

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

/** Смещение пояса от UTC в минутах в этот момент: +180 для Москвы, −300 для Нью-Йорка зимой */
export const zoneOffset = (zone: string, instant: Date): number => {
  const w = wallParts(instant, zone);
  const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
};

/** Момент времени, когда в поясе на часах эта дата и время. Несуществующее время (переход на летнее)
 *  сдвигается вперёд, а двойное (переход на зимнее) берётся первым, как в Google */
export const fromZonedParts = (y: number, mo: number, d: number, h: number, mi: number, s: number, zone: string): Date => {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  // смещение за сутки до и после: переходов чаще одного в сутки не бывает
  const before = zoneOffset(zone, new Date(guess - DAY));
  const after = zoneOffset(zone, new Date(guess + DAY));
  const fits = (t: number) => zoneOffset(zone, new Date(t)) * 60_000 === guess - t;
  const found = [guess - before * 60_000, guess - after * 60_000].filter(fits);
  // времени нет на часах — считаем по смещению до перехода, это и есть сдвиг вперёд
  return new Date(found.length ? Math.min(...found) : guess - before * 60_000);
};

/** "2026-11-04" и "09:30" по часам пояса → момент времени */
export const fromZoned = (dateKey: string, timeKey: string, zone: string): Date => {
  const [y, mo, d] = dateKey.split("-").map(Number);
  const [h, mi] = timeKey.split(":").map(Number);
  return fromZonedParts(y, mo, d, h || 0, mi || 0, 0, zone);
};

/** Часы пояса в виде местной даты: её год, месяц, число и время равны тому, что видно в поясе.
 *  Так с ней работают обычные функции дат (день недели, ключ даты) */
export const wallClock = (instant: Date, zone: string): Date => {
  const w = wallParts(instant, zone);
  return new Date(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
};

/** Обратно: местная дата как часы пояса → момент времени */
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
/** Все пояса, которые знает Intl; системный и UTC добавляются, если их нет в списке */
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

/** город из id пояса: "America/Argentina/Buenos_Aires" → "Buenos Aires" */
export const zoneCity = (zone: string): string => zone.slice(zone.lastIndexOf("/") + 1).replaceAll("_", " ");

/** Подпись для списка: «(GMT+03:00) Москва, стандартное время — Moscow». Название пояса — на языке интерфейса */
export const zoneLabel = (zone: string, at = new Date()): string => {
  const offset = formatOffset(zoneOffset(zone, at));
  const name = zoneName(zone, "longGeneric", at);
  const city = zoneCity(zone);
  if (zone === "UTC") return `(${offset}) UTC`;
  return name && !name.startsWith("GMT") ? `(${offset}) ${name} — ${city}` : `(${offset}) ${city}`;
};

/** Короткое название над колонкой часов: «MSK», «PST», «GMT+9» */
export const zoneShort = (zone: string, at = new Date()): string => {
  const short = zoneName(zone, "short", at);
  return short || formatOffset(zoneOffset(zone, at));
};

/** Время во втором поясе на каждой часовой линии сетки этого дня: «9:00 у нас» → часы и минуты там.
 *  Минуты не нулевые у поясов вроде Индии (+5:30) */
export const zoneHours = (day: Date, zone: string): { hour: number; minute: number }[] =>
  Array.from({ length: 24 }, (_, h) => {
    const wall = wallClock(new Date(day.getFullYear(), day.getMonth(), day.getDate(), h), zone);
    return { hour: wall.getHours(), minute: wall.getMinutes() };
  });

/** Пояса для списка, отсортированные по смещению, затем по городу */
export const sortedTimeZones = (at = new Date()): { zone: string; offset: number }[] =>
  allTimeZones()
    .map((zone) => ({ zone, offset: zoneOffset(zone, at) }))
    .sort((a, b) => a.offset - b.offset || zoneCity(a.zone).localeCompare(zoneCity(b.zone)));
