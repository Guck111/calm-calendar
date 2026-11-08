// Общая часть разбора строки быстрого создания: вырезание распознанных кусков,
// метки календаря и места, сборка события из даты, времени и длительности.
// Словари и шаблоны каждого языка — в quick.ts (русский) и quick-en.ts (английский).
import { addDays, addMinutes, startOfDay } from "./date";

export type QuickCalendar = { id: string; name: string };

export type QuickResult = {
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  calendarId?: string;
  location?: string;
};

export type TimeRange = { h: number; m: number; endH?: number; endM?: number };

// \b в JS не понимает кириллицу, поэтому границы слова — через юникод-классы.
// \p{M} — огласовки хинди и бенгали: они часть слова, а не граница.
export const L = "(?<![\\p{L}\\p{M}\\d])";
export const R = "(?![\\p{L}\\p{M}\\d])";
export const re = (body: string) => new RegExp(`${L}${body}${R}`, "iu");

/** Нули цифр, которые набирают вместо 0–9: арабские, персидские, деванагари, бенгальские, полноширинные */
const DIGIT_ZEROS = [0x660, 0x6f0, 0x966, 0x9e6, 0xff10];

const PUNCTUATION: Record<string, string> = {
  "：": ":", // полноширинное двоеточие (китайский, японский)
  "－": "-",
  "～": "-",
  "〜": "-",
  "،": ",", // арабская запятая
  "٫": ",", // арабский десятичный разделитель
  "＃": "#",
  "＠": "@",
  "　": " ",
};

/** Цифры любого письма — в 0–9, полноширинные знаки — в обычные: дальше разбор видит одно и то же */
export const normalizeInput = (input: string): string =>
  input.replace(/[\p{Nd}：－～〜،٫＃＠　]/gu, (ch) => {
    if (PUNCTUATION[ch]) return PUNCTUATION[ch];
    const code = ch.charCodeAt(0);
    const zero = DIGIT_ZEROS.find((z) => code >= z && code <= z + 9);
    return zero === undefined ? ch : String(code - zero);
  });

export type Cut = { text: string; take: (r: RegExp) => RegExpMatchArray | null };

export const cutter = (input: string): Cut => {
  const state = { text: ` ${input} ` };
  return {
    get text() {
      return state.text;
    },
    take(r: RegExp) {
      const m = state.text.match(r);
      if (m && m.index !== undefined) {
        state.text = `${state.text.slice(0, m.index)} ${state.text.slice(m.index + m[0].length)}`;
      }
      return m;
    },
  };
};

export const validTime = (h: number, m: number) => h >= 0 && h <= 23 && m >= 0 && m <= 59;

const withTime = (day: Date, h: number, m: number) =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);

/** Понедельник — 0. Не зависит от первого дня недели региона: словари дней начинаются с понедельника */
export const mondayIndex = (d: Date): number => (d.getDay() + 6) % 7;

/** Ближайший день недели (0 — понедельник) начиная с сегодня; skipToday — «next friday» */
export const nextWeekday = (today: Date, index: number, skipToday = false): Date => {
  const ahead = (index - mondayIndex(today) + 7) % 7;
  return addDays(today, ahead === 0 && skipToday ? 7 : ahead);
};

/** Дата без года, которая уже прошла, — в следующем году */
export const upcomingDate = (today: Date, month: number, day: number, year: number | null): Date => {
  const d = new Date(year ?? today.getFullYear(), month, day);
  return year === null && d < today ? new Date(d.getFullYear() + 1, month, day) : d;
};

const findCalendar = (tag: string, calendars: QuickCalendar[]): string | undefined => {
  const t = tag.toLowerCase();
  const byStart = calendars.find((c) => c.name.toLowerCase().startsWith(t));
  return (byStart ?? calendars.find((c) => c.name.toLowerCase().includes(t)))?.id;
};

/** «#работа» и «@Офис_Гдыня» — одинаково на любом языке */
export const takeTags = (cut: Cut, calendars: QuickCalendar[]) => {
  const tag = cut.take(/(?:^|\s)#(\S+)/u);
  const place = cut.take(/(?:^|\s)@(\S+)/u);
  return {
    calendarId: tag ? findCalendar(tag[1], calendars) : undefined,
    location: place ? place[1].replace(/_/g, " ") : undefined,
  };
};

/** Остаток строки — название; висящие по краям предлоги убираем */
export const cleanTitle = (text: string, prepositions: string): string =>
  text
    .replace(/\s+/g, " ")
    .trim()
    .replace(new RegExp(`^(?:${prepositions})\\s+`, "iu"), "")
    .replace(new RegExp(`\\s+(?:${prepositions})$`, "iu"), "")
    .trim();

const DEFAULT_MINUTES = 60;

export type Parsed = {
  title: string;
  date: Date | null;
  time: TimeRange | null;
  duration: number | null;
  calendarId?: string;
  location?: string;
};

export const assemble = (p: Parsed, now: Date): QuickResult => {
  const { title, date, time, duration, calendarId, location } = p;
  if (!time) {
    const day = date ?? startOfDay(now);
    return { title, start: day, end: addDays(day, 1), allDay: true, calendarId, location };
  }

  let day = date ?? startOfDay(now);
  let start = withTime(day, time.h, time.m);
  // без даты и со временем, которое уже прошло, — значит завтра
  if (!date && start < now) {
    day = addDays(day, 1);
    start = withTime(day, time.h, time.m);
  }
  let end =
    time.endH !== undefined
      ? withTime(day, time.endH, time.endM ?? 0)
      : addMinutes(start, duration ?? DEFAULT_MINUTES);
  // «23-1»: конец на следующий день
  if (end <= start) end = addDays(end, 1);

  return { title, start, end, allDay: false, calendarId, location };
};
