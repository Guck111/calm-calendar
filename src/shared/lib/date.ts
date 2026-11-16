// Working with dates on native Date and Intl, no libraries.
// Language and region (first day of week, 12 or 24 hours) come from i18n.
import { locale, t, uses12h, weekStart } from "../i18n";

export type ViewMode = "month" | "week" | "day" | "agenda";

/** how many days "Schedule" shows and pages by */
export const AGENDA_DAYS = 28;

export type DateRange = { start: Date; end: Date };

export const MINUTES_IN_DAY = 24 * 60;

/** Calendar day boundary, even if midnight was skipped on the original day. */
export const addCalendarDays = (d: Date, n: number): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export const startOfDay = (d: Date): Date => addCalendarDays(d, 0);

/** Wall clock hours stored in UTC so the system time zone doesn't normalize them. */
export class WallClockDate extends Date {
  getFullYear() { return this.getUTCFullYear(); }
  getMonth() { return this.getUTCMonth(); }
  getDate() { return this.getUTCDate(); }
  getDay() { return this.getUTCDay(); }
  getHours() { return this.getUTCHours(); }
  getMinutes() { return this.getUTCMinutes(); }
  getSeconds() { return this.getUTCSeconds(); }
  getTimezoneOffset() { return 0; }
}

// Shift by calendar days: correct across the switch to summer and winter time
export const addDays = (d: Date, n: number): Date =>
  new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate() + n,
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
  );

export const addMinutes = (d: Date, n: number): Date => new Date(d.getTime() + n * 60_000);

export const startOfMonth = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), 1);

export const addMonths = (d: Date, n: number): Date => {
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), lastDay));
};

/** day index in the week considering the region's first day of week: 0 — the first column */
export const weekdayIndex = (d: Date): number => (d.getDay() - weekStart() + 7) % 7;

export const startOfWeek = (d: Date): Date => addCalendarDays(d, -weekdayIndex(d));

export const isSameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export const isSameMonth = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

const pad = (n: number): string => String(n).padStart(2, "0");

/** "2026-11-04" in local time */
export const toDateKey = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** "2026-11-04" → midnight local time */
export const fromDateKey = (key: string): Date => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** "09:30" */
export const toTimeKey = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export const combineDateTime = (dateKey: string, timeKey: string): Date => {
  const [h, m] = timeKey.split(":").map(Number);
  const day = fromDateKey(dateKey);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h || 0, m || 0);
};

export const minutesOfDay = (d: Date): number => d.getHours() * 60 + d.getMinutes();

export const daysBetween = (start: Date, end: Date): number =>
  Math.round((startOfDay(end).getTime() - startOfDay(start).getTime()) / 86_400_000);

/** 6 weeks of 7 days, like a regular wall calendar */
export const monthGrid = (cursor: Date): Date[] => {
  const first = startOfWeek(startOfMonth(cursor));
  return Array.from({ length: 42 }, (_, i) => addCalendarDays(first, i));
};

export const weekDays = (cursor: Date): Date[] => {
  const first = startOfWeek(cursor);
  return Array.from({ length: 7 }, (_, i) => addCalendarDays(first, i));
};

export const viewDays = (view: ViewMode, cursor: Date): Date[] => {
  switch (view) {
    case "month":
      return monthGrid(cursor);
    case "week":
      return weekDays(cursor);
    case "day":
      return [startOfDay(cursor)];
    case "agenda":
      return Array.from({ length: AGENDA_DAYS }, (_, i) => addCalendarDays(cursor, i));
  }
};

export const viewRange = (view: ViewMode, cursor: Date): DateRange => {
  const days = viewDays(view, cursor);
  return { start: days[0], end: addCalendarDays(days[days.length - 1], 1) };
};

export const shiftCursor = (view: ViewMode, cursor: Date, step: 1 | -1): Date => {
  switch (view) {
    case "month":
      return addMonths(cursor, step);
    case "week":
      return addDays(cursor, 7 * step);
    case "day":
      return addDays(cursor, step);
    case "agenda":
      return addDays(cursor, AGENDA_DAYS * step);
  }
};

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
/** «ноябрь 2026 г.» → «ноябрь 2026», and the Ukrainian «р.» */
const dropYearSuffix = (s: string): string => s.replace(/\s*[гр]\.$/, "");

// Formatters remember the time zone on creation, so it is part of the key.
const cache = new Map<string, Intl.DateTimeFormat>();
const formatter = (options: Intl.DateTimeFormatOptions, date?: Date): Intl.DateTimeFormat => {
  const timeZone = date instanceof WallClockDate ? "UTC" : localTimeZone();
  const key = `${locale}|${timeZone}|${JSON.stringify(options)}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...options, timeZone });
    cache.set(key, f);
  }
  return f;
};
const fmt = (options: Intl.DateTimeFormatOptions) => (d: Date) => formatter(options, d).format(d);

let numbers: { locale: string; f: Intl.NumberFormat } | null = null;
/** Day number in the language's digits: «٨» in Arabic, «৮» in Bengali, without «日» and «일» that the date format would add */
export const formatDayNumber = (d: Date): string => {
  if (numbers?.locale !== locale) numbers = { locale, f: new Intl.NumberFormat(locale, { useGrouping: false }) };
  return numbers.f.format(d.getDate());
};

/** ISO 8601 week number: week from Monday, the first one contains the year's first Thursday */
export const isoWeek = (d: Date): number => {
  const day = startOfDay(d);
  const thursday = addDays(day, 3 - ((day.getDay() + 6) % 7));
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  const firstWeekThursday = addDays(firstThursday, 3 - ((firstThursday.getDay() + 6) % 7));
  return 1 + Math.round((thursday.getTime() - firstWeekThursday.getTime()) / (7 * 86_400_000));
};

/** Week number of a calendar row starting at d. A row may start on Sunday or Saturday,
 *  so take its middle: that way the whole row has one number */
export const weekNumberOf = (rowStart: Date): number => isoWeek(addDays(rowStart, 3));

/** week number in the language's digits */
export const formatWeekNumber = (rowStart: Date): string => {
  if (numbers?.locale !== locale) numbers = { locale, f: new Intl.NumberFormat(locale, { useGrouping: false }) };
  return numbers.f.format(weekNumberOf(rowStart));
};

export const formatMonthYear = (d: Date): string =>
  capitalize(dropYearSuffix(fmt({ month: "long", year: "numeric" })(d)));
export const formatMonthShort = fmt({ month: "short" });
export const formatWeekdayShort = fmt({ weekday: "short" });
export const formatWeekdayLong = (d: Date): string => capitalize(fmt({ weekday: "long" })(d));
export const formatDayMonth = fmt({ day: "numeric", month: "long" });
export const formatFullDate = (d: Date): string =>
  capitalize(dropYearSuffix(fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" })(d)));
/** "09:30" or "9:30 AM" by region */
export const formatTime = (d: Date): string =>
  fmt({ hour: uses12h() ? "numeric" : "2-digit", minute: "2-digit" })(d);
/** Time for the big clock: digits apart from AM/PM so they can be set smaller */
export const formatClock = (d: Date): { time: string; period: string } => {
  const parts = formatter({ hour: uses12h() ? "numeric" : "2-digit", minute: "2-digit" }, d).formatToParts(d);
  const period = parts.find((p) => p.type === "dayPeriod")?.value ?? "";
  const time = parts
    .filter((p) => p.type !== "dayPeriod")
    .map((p) => p.value)
    .join("")
    .trim();
  return { time, period };
};
/** hour label in the grid: "09:00" or "9 AM" */
export const formatHour = (h: number): string =>
  uses12h() ? fmt({ hour: "numeric" })(new Date(2000, 0, 1, h)) : `${pad(h)}:00`;
/** «Чт, 5 нояб.» for dates of this year and «5 нояб. 2027 г.» for others */
export const formatShortDate = (d: Date, now = new Date()): string =>
  dropYearSuffix(
    d.getFullYear() === now.getFullYear()
      ? fmt({ weekday: "short", day: "numeric", month: "short" })(d)
      : fmt({ day: "numeric", month: "short", year: "numeric" })(d),
  );
/** «Чт, 5 ноября» */
export const formatWeekdayDayMonth = (d: Date): string =>
  capitalize(fmt({ weekday: "short", day: "numeric", month: "long" })(d));

/** Weekday labels from the region's first day of week: «Пн», «Вт»… or «S», «M»… in the mini month */
export const weekdayLabels = (style: "short" | "narrow" = "short"): string[] => {
  const ref = startOfWeek(new Date(2026, 0, 7));
  // narrow letters П В С Ч П С can't be told apart in Slavic languages
  const format = fmt({ weekday: /^(ru|be|uk)\b/.test(locale) ? "short" : style });
  return Array.from({ length: 7 }, (_, i) => capitalize(format(addDays(ref, i))));
};

export const viewTitle = (view: ViewMode, cursor: Date): string => {
  if (view === "month") return formatMonthYear(cursor);
  if (view === "day") return formatFullDate(cursor);
  const days = viewDays(view, cursor);
  // «2–8 ноября 2026», «November 2 – 8, 2026»: a range by the language's rules
  return dropYearSuffix(
    formatter({ day: "numeric", month: "long", year: "numeric" }).formatRange(days[0], days[days.length - 1]),
  );
};

/** «30 мин», «1 ч 30 мин» */
export const formatSpan = (minutes: number): string => t.time.span(Math.floor(minutes / 60), minutes % 60);

export const localTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;
