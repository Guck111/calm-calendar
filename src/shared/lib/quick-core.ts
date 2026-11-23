// Shared part of quick add parsing: cutting out recognized pieces,
// calendar and location tags, assembling an event from date, time and duration.
// Vocabularies and patterns of each language are in quick.ts (Russian) and quick-en.ts (English).
import { addDays, addMinutes, MINUTES_IN_DAY, startOfDay } from "./date";

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

// \b in JS doesn't understand Cyrillic, so word boundaries use Unicode classes.
// \p{M} — Hindi and Bengali vowel signs: they are part of the word, not a boundary.
export const L = "(?<![\\p{L}\\p{M}\\d])";
export const R = "(?![\\p{L}\\p{M}\\d])";
// the group is needed so the boundaries apply to all alternatives of «завтра|tmrw», not just the outer ones
export const re = (body: string) => new RegExp(`${L}(?:${body})${R}`, "iu");

/** Zeros of digits typed instead of 0–9: Arabic, Persian, Devanagari, Bengali, full-width */
const DIGIT_ZEROS = [0x660, 0x6f0, 0x966, 0x9e6, 0xff10];

const PUNCTUATION: Record<string, string> = {
  "：": ":", // full-width colon (Chinese, Japanese)
  "－": "-",
  "～": "-",
  "〜": "-",
  "،": ",", // Arabic comma
  "٫": ",", // Arabic decimal separator
  "＃": "#",
  "＠": "@",
  "　": " ",
};

/** Digits of any script → 0–9, full-width characters → regular ones: from here on the parser sees the same thing.
 *  NFC: «য়» and «ड़» are typed as one character or two — patterns see one form */
export const normalizeInput = (input: string): string =>
  input.normalize("NFC").replace(/[\p{Nd}：－～〜،٫＃＠　]/gu, (ch) => {
    if (PUNCTUATION[ch]) return PUNCTUATION[ch];
    const code = ch.charCodeAt(0);
    const zero = DIGIT_ZEROS.find((z) => code >= z && code <= z + 9);
    return zero === undefined ? ch : String(code - zero);
  });

export type Cut = {
  text: string;
  take: (r: RegExp) => RegExpMatchArray | null;
  /** the first match that passed accept: «2 से 3 लोग» without «बजे» is not a time */
  takeWhere: (r: RegExp, accept: (m: RegExpMatchArray) => boolean) => RegExpMatchArray | null;
};

export const cutter = (input: string): Cut => {
  const state = { text: ` ${input} ` };
  const remove = (m: RegExpMatchArray) => {
    const at = m.index ?? 0;
    state.text = `${state.text.slice(0, at)} ${state.text.slice(at + m[0].length)}`;
  };
  return {
    get text() {
      return state.text;
    },
    take(r: RegExp) {
      const m = state.text.match(r);
      if (m && m.index !== undefined) remove(m);
      return m;
    },
    takeWhere(r: RegExp, accept: (m: RegExpMatchArray) => boolean) {
      const global = new RegExp(r.source, r.flags.includes("g") ? r.flags : `${r.flags}g`);
      for (const m of state.text.matchAll(global)) {
        if (accept(m)) {
          remove(m);
          return m;
        }
      }
      return null;
    },
  };
};

export const validTime = (h: number, m: number) => h >= 0 && h <= 23 && m >= 0 && m <= 59;

const withTime = (day: Date, h: number, m: number) =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);

/** Monday is 0. Doesn't depend on the region's first day of week: day vocabularies start with Monday */
export const mondayIndex = (d: Date): number => (d.getDay() + 6) % 7;

/** Nearest weekday (0 — Monday) starting from today; skipToday — "next friday" */
export const nextWeekday = (today: Date, index: number, skipToday = false): Date => {
  const ahead = (index - mondayIndex(today) + 7) % 7;
  return addDays(today, ahead === 0 && skipToday ? 7 : ahead);
};

/** A date without a year is the nearest valid one. A nonexistent date with a year is invalid. */
export const upcomingDate = (today: Date, month: number, day: number, year: number | null): Date => {
  const atYear = (y: number) => {
    const date = new Date(y, month, day);
    return date.getFullYear() === y && date.getMonth() === month && date.getDate() === day ? date : new Date(NaN);
  };
  if (year !== null) return atYear(year);

  const currentYear = today.getFullYear();
  // At a century boundary eight years may pass between leap years.
  const lastYear = currentYear + (month === 1 && day === 29 ? 8 : 1);
  for (let y = currentYear; y <= lastYear; y++) {
    const date = atYear(y);
    if (date >= today) return date;
  }
  return new Date(NaN);
};

const findCalendar = (tag: string, calendars: QuickCalendar[]): string | undefined => {
  const t = tag.toLowerCase();
  const byStart = calendars.find((c) => c.name.toLowerCase().startsWith(t));
  return (byStart ?? calendars.find((c) => c.name.toLowerCase().includes(t)))?.id;
};

/** «#работа» and «@Офис_Гдыня» — the same in any language */
export const takeTags = (cut: Cut, calendars: QuickCalendar[]) => {
  const tag = cut.take(/(?:^|\s)#(\S+)/u);
  const place = cut.take(/(?:^|\s)@(\S+)/u);
  return {
    calendarId: tag ? findCalendar(tag[1], calendars) : undefined,
    location: place ? place[1].replace(/_/g, " ") : undefined,
  };
};

/** The rest of the string is the title; dangling prepositions at the edges are removed */
export const cleanTitle = (text: string, prepositions: string): string =>
  text
    .replace(/\s+/g, " ")
    .trim()
    .replace(new RegExp(`^(?:${prepositions})\\s+`, "iu"), "")
    .replace(new RegExp(`\\s+(?:${prepositions})$`, "iu"), "")
    .trim();

/** «ужин с Олей» → «Ужин с Олей»; a first word with its own capitals («iPhone») is left as typed */
export const capitalizeTitle = (title: string, locale: string): string => {
  const firstWord = title.split(" ", 1)[0];
  if (firstWord !== firstWord.toLocaleLowerCase(locale)) return title;
  const first = [...title][0] ?? "";
  return first.toLocaleUpperCase(locale) + title.slice(first.length);
};

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
  // no date and a time that has already passed means tomorrow
  if (!date && start < now) {
    day = addDays(day, 1);
    start = withTime(day, time.h, time.m);
  }
  let end: Date;
  if (time.endH === undefined) {
    end = addMinutes(start, duration ?? DEFAULT_MINUTES);
    if (end <= start) end = addDays(end, 1);
  } else {
    const endM = time.endM ?? 0;
    const span = (time.endH - time.h) * 60 + endM - time.m;
    // «23-1»: the end is on the next day. Compare the entered hours before the switch to summer time.
    end = withTime(span <= 0 ? addDays(day, 1) : day, time.endH, endM);
    if (end <= start) end = addMinutes(start, span > 0 ? span : span + MINUTES_IN_DAY);
  }

  return { title, start, end, allDay: false, calendarId, location };
};
