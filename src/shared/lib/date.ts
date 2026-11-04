// Работа с датами на нативном Date и Intl, без библиотек. Неделя начинается с понедельника.

export type ViewMode = "month" | "week" | "day";

export type DateRange = { start: Date; end: Date };

export const LOCALE = "ru-RU";
export const MINUTES_IN_DAY = 24 * 60;

export const startOfDay = (d: Date): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());

// Сдвиг по календарным дням: корректен при переходе на летнее и зимнее время
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

export const weekdayIndex = (d: Date): number => (d.getDay() + 6) % 7;

export const startOfWeek = (d: Date): Date => addDays(startOfDay(d), -weekdayIndex(d));

export const isSameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export const isSameMonth = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

const pad = (n: number): string => String(n).padStart(2, "0");

/** "2026-11-04" в местном времени */
export const toDateKey = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** "2026-11-04" → полночь по местному времени */
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

/** 6 недель по 7 дней, как в обычном настенном календаре */
export const monthGrid = (cursor: Date): Date[] => {
  const first = startOfWeek(startOfMonth(cursor));
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
};

export const weekDays = (cursor: Date): Date[] => {
  const first = startOfWeek(cursor);
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
};

export const viewDays = (view: ViewMode, cursor: Date): Date[] => {
  switch (view) {
    case "month":
      return monthGrid(cursor);
    case "week":
      return weekDays(cursor);
    case "day":
      return [startOfDay(cursor)];
  }
};

export const viewRange = (view: ViewMode, cursor: Date): DateRange => {
  const days = viewDays(view, cursor);
  return { start: days[0], end: addDays(days[days.length - 1], 1) };
};

export const shiftCursor = (view: ViewMode, cursor: Date, step: 1 | -1): Date => {
  switch (view) {
    case "month":
      return addMonths(cursor, step);
    case "week":
      return addDays(cursor, 7 * step);
    case "day":
      return addDays(cursor, step);
  }
};

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const fmt = (options: Intl.DateTimeFormatOptions) => {
  const f = new Intl.DateTimeFormat(LOCALE, options);
  return (d: Date) => f.format(d);
};

export const formatMonthYear = (d: Date): string =>
  capitalize(fmt({ month: "long", year: "numeric" })(d).replace(/\s*г\.$/, ""));
export const formatMonthShort = fmt({ month: "short" });
export const formatWeekdayShort = fmt({ weekday: "short" });
export const formatWeekdayLong = (d: Date): string => capitalize(fmt({ weekday: "long" })(d));
export const formatDayMonth = fmt({ day: "numeric", month: "long" });
export const formatFullDate = (d: Date): string =>
  capitalize(fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" })(d).replace(/\s*г\.$/, ""));
export const formatTime = fmt({ hour: "2-digit", minute: "2-digit" });

export const viewTitle = (view: ViewMode, cursor: Date): string => {
  if (view === "month") return formatMonthYear(cursor);
  if (view === "day") return formatFullDate(cursor);
  const days = weekDays(cursor);
  const first = days[0];
  const last = days[6];
  if (isSameMonth(first, last)) {
    return `${first.getDate()}–${last.getDate()} ${formatDayMonth(last).split(" ")[1]} ${last.getFullYear()}`;
  }
  const sameYear = first.getFullYear() === last.getFullYear();
  return `${formatDayMonth(first)}${sameYear ? "" : ` ${first.getFullYear()}`} – ${formatDayMonth(last)} ${last.getFullYear()}`;
};

export const localTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;
