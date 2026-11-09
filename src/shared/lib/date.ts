// Работа с датами на нативном Date и Intl, без библиотек.
// Язык и регион (первый день недели, 12 или 24 часа) берутся из i18n.
import { locale, uses12h, weekStart } from "../i18n";

export type ViewMode = "month" | "week" | "day" | "agenda";

/** сколько дней показывает «Расписание» и на сколько листает */
export const AGENDA_DAYS = 28;

export type DateRange = { start: Date; end: Date };

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

/** номер дня в неделе с учётом первого дня недели региона: 0 — первый столбец */
export const weekdayIndex = (d: Date): number => (d.getDay() - weekStart() + 7) % 7;

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
    case "agenda":
      return Array.from({ length: AGENDA_DAYS }, (_, i) => addDays(startOfDay(cursor), i));
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
    case "agenda":
      return addDays(cursor, AGENDA_DAYS * step);
  }
};

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
/** «ноябрь 2026 г.» → «ноябрь 2026» */
const dropYearSuffix = (s: string): string => s.replace(/\s*г\.$/, "");

// форматтеры создаём лениво и запоминаем для текущего языка
const cache = new Map<string, Intl.DateTimeFormat>();
const formatter = (options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat => {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    cache.set(key, f);
  }
  return f;
};
const fmt = (options: Intl.DateTimeFormatOptions) => (d: Date) => formatter(options).format(d);

let numbers: { locale: string; f: Intl.NumberFormat } | null = null;
/** Число дня цифрами языка: «٨» по-арабски, «৮» по-бенгальски, без «日» и «일», которые добавил бы формат даты */
export const formatDayNumber = (d: Date): string => {
  if (numbers?.locale !== locale) numbers = { locale, f: new Intl.NumberFormat(locale, { useGrouping: false }) };
  return numbers.f.format(d.getDate());
};

/** Номер недели по ISO 8601: неделя с понедельника, первая — та, где первый четверг года */
export const isoWeek = (d: Date): number => {
  const day = startOfDay(d);
  const thursday = addDays(day, 3 - ((day.getDay() + 6) % 7));
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  const firstWeekThursday = addDays(firstThursday, 3 - ((firstThursday.getDay() + 6) % 7));
  return 1 + Math.round((thursday.getTime() - firstWeekThursday.getTime()) / (7 * 86_400_000));
};

/** Номер недели строки календаря, начатой с d. Строка может начинаться с воскресенья или субботы,
 *  поэтому берём её середину: так у всей строки один номер */
export const weekNumberOf = (rowStart: Date): number => isoWeek(addDays(rowStart, 3));

/** номер недели цифрами языка */
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
/** «09:30» или «9:30 AM» по региону */
export const formatTime = (d: Date): string =>
  fmt({ hour: uses12h() ? "numeric" : "2-digit", minute: "2-digit" })(d);
/** Время для крупных часов: цифры отдельно от AM/PM, чтобы набрать их мельче */
export const formatClock = (d: Date): { time: string; period: string } => {
  const parts = formatter({ hour: uses12h() ? "numeric" : "2-digit", minute: "2-digit" }).formatToParts(d);
  const period = parts.find((p) => p.type === "dayPeriod")?.value ?? "";
  const time = parts
    .filter((p) => p.type !== "dayPeriod")
    .map((p) => p.value)
    .join("")
    .trim();
  return { time, period };
};
/** подпись часа в сетке: «09:00» или «9 AM» */
export const formatHour = (h: number): string =>
  uses12h() ? fmt({ hour: "numeric" })(new Date(2000, 0, 1, h)) : `${pad(h)}:00`;
/** «Чт, 5 нояб.» для дат этого года и «5 нояб. 2027 г.» для других */
export const formatShortDate = (d: Date, now = new Date()): string =>
  dropYearSuffix(
    d.getFullYear() === now.getFullYear()
      ? fmt({ weekday: "short", day: "numeric", month: "short" })(d)
      : fmt({ day: "numeric", month: "short", year: "numeric" })(d),
  );
/** «Чт, 5 ноября» */
export const formatWeekdayDayMonth = (d: Date): string =>
  capitalize(fmt({ weekday: "short", day: "numeric", month: "long" })(d));

/** Подписи дней недели с первого дня недели региона: «Пн», «Вт»… или «S», «M»… в мини-месяце */
export const weekdayLabels = (style: "short" | "narrow" = "short"): string[] => {
  const ref = startOfWeek(new Date(2026, 0, 7));
  const format = fmt({ weekday: locale.startsWith("ru") ? "short" : style });
  return Array.from({ length: 7 }, (_, i) => capitalize(format(addDays(ref, i))));
};

export const viewTitle = (view: ViewMode, cursor: Date): string => {
  if (view === "month") return formatMonthYear(cursor);
  if (view === "day") return formatFullDate(cursor);
  const days = viewDays(view, cursor);
  // «2–8 ноября 2026», «November 2 – 8, 2026»: диапазон по правилам языка
  return dropYearSuffix(
    formatter({ day: "numeric", month: "long", year: "numeric" }).formatRange(days[0], days[days.length - 1]),
  );
};

export const localTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;
