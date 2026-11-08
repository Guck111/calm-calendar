// English quick add: "tomorrow 7pm English class 50 min #personal @Office".
// Same flow as the Russian parser (quick.ts): recognised parts are cut out, the rest is the title.
import { addDays, startOfDay } from "./date";
import {
  L,
  assemble,
  cleanTitle,
  cutter,
  nextWeekday,
  re,
  takeTags,
  upcomingDate,
  validTime,
  type Cut,
  type QuickCalendar,
  type QuickResult,
  type TimeRange,
} from "./quick-core";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = `(${MONTHS.join("|")})[a-z]*\\.?`;
/** Monday first */
const WEEKDAYS = [
  "mon(?:day)?",
  "tue(?:s(?:day)?)?",
  "wed(?:nesday)?",
  "thu(?:r(?:s(?:day)?)?)?",
  "fri(?:day)?",
  "sat(?:urday)?",
  "sun(?:day)?",
];
const ORDINAL = "(?:st|nd|rd|th)?";
const YEAR = "(?:,?\\s+(\\d{4}))?";

const monthIndex = (name: string) => MONTHS.findIndex((m) => name.toLowerCase().startsWith(m));

type DateHit = { date: Date; evening?: boolean };

const parseDate = (cut: Cut, now: Date): DateHit | null => {
  const today = startOfDay(now);

  if (cut.take(re("(?:the\\s+)?day\\s+after\\s+tomorrow"))) return { date: addDays(today, 2) };
  if (cut.take(re("tomorrow|tmrw"))) return { date: addDays(today, 1) };
  if (cut.take(re("tonight"))) return { date: today, evening: true };
  if (cut.take(re("today"))) return { date: today };

  const after = cut.take(re("in\\s+(\\d+)\\s+(days?|weeks?)"));
  if (after) {
    const n = Number(after[1]);
    return { date: addDays(today, after[2].toLowerCase().startsWith("week") ? n * 7 : n) };
  }

  // "Nov 5", "November 5th, 2027"
  const monthFirst = cut.take(re(`${MONTH}\\s+(\\d{1,2})${ORDINAL}${YEAR}`));
  if (monthFirst) {
    const year = monthFirst[3] ? Number(monthFirst[3]) : null;
    return { date: upcomingDate(today, monthIndex(monthFirst[1]), Number(monthFirst[2]), year) };
  }
  // "5 Nov", "5th of November"
  const dayFirst = cut.take(re(`(\\d{1,2})${ORDINAL}\\s+(?:of\\s+)?${MONTH}${YEAR}`));
  if (dayFirst) {
    const year = dayFirst[3] ? Number(dayFirst[3]) : null;
    return { date: upcomingDate(today, monthIndex(dayFirst[2]), Number(dayFirst[1]), year) };
  }

  // "fri", "on Friday" — the nearest one, today included; "next friday" skips today
  for (let i = 0; i < WEEKDAYS.length; i++) {
    const m = cut.take(re(`(?:(on|next)\\s+)?(?:${WEEKDAYS[i]})`));
    if (m) return { date: nextWeekday(today, i, m[1]?.toLowerCase() === "next") };
  }
  return null;
};

const PART = "([ap])\\.?m\\.?";
const CLOCK = "(\\d{1,2})(?::(\\d{2}))?";

/** 12-hour clock to 24: 12am is midnight, 12pm is noon */
const to24 = (h: number, part?: string): number => {
  if (!part) return h;
  const pm = part.toLowerCase() === "p";
  if (h === 12) return pm ? 12 : 0;
  return pm ? h + 12 : h;
};

const parseTime = (cut: Cut, evening: boolean): TimeRange | null => {
  if (cut.take(re("(?:at\\s+)?noon"))) return { h: 12, m: 0 };
  if (cut.take(re("(?:at\\s+)?midnight"))) return { h: 0, m: 0 };

  // "7-9pm", "from 2 to 3:30pm", "19:00-20:30", "11am-1pm"
  const range = cut.take(re(`(?:from\\s+)?${CLOCK}\\s*(?:${PART})?\\s*(?:-|–|—|to|until|till)\\s*${CLOCK}\\s*(?:${PART})?`));
  if (range) {
    const [startH, endH] = [Number(range[1]), Number(range[4])];
    const endPart = range[6];
    // "7-9pm": the start takes the end's am/pm, unless that would put it after the end ("11-1pm")
    const startPart = range[3] ?? (endPart && !(endPart.toLowerCase() === "p" && startH > endH && startH !== 12) ? endPart : undefined);
    const h = to24(startH, startPart);
    const m = Number(range[2] ?? 0);
    const eh = to24(endH, endPart);
    const em = Number(range[5] ?? 0);
    if (validTime(h, m) && validTime(eh, em)) return { h, m, endH: eh, endM: em };
  }

  // "7pm", "at 7:30 pm"
  const withPart = cut.take(re(`(?:at\\s+)?${CLOCK}\\s*${PART}`));
  if (withPart) {
    const h = to24(Number(withPart[1]), withPart[3]);
    const m = Number(withPart[2] ?? 0);
    if (validTime(h, m)) return { h, m };
  }

  // "19:00", "at 7:30"; "tonight at 8" means 20:00
  const evening24 = (h: number) => (evening && h < 12 ? h + 12 : h);
  const exact = cut.take(re("(?:at\\s+)?(\\d{1,2}):(\\d{2})"));
  if (exact) {
    const h = evening24(Number(exact[1]));
    const m = Number(exact[2]);
    if (validTime(h, m)) return { h, m };
  }
  const short = cut.take(re("at\\s+(\\d{1,2})(?!\\s*(?:min|h|hour|day|week))"));
  if (short) {
    const h = evening24(Number(short[1]));
    if (validTime(h, 0)) return { h, m: 0 };
  }
  return null;
};

const parseDuration = (cut: Cut): number | null => {
  if (cut.take(re("(?:for\\s+)?half\\s+an?\\s+hour"))) return 30;
  const d = cut.take(re("(?:for\\s+)?(\\d+(?:[.,]\\d+)?)\\s*(m|mins?|minutes?|h|hrs?|hours?)"));
  if (!d) return null;
  const n = Number(d[1].replace(",", "."));
  return Math.round(d[2].toLowerCase().startsWith("h") ? n * 60 : n);
};

// "fri 18 cinema", "tomorrow 9 gym": a number right after a day is an hour
const DAY_WORDS = [
  "today",
  "tonight",
  "tomorrow",
  "tmrw",
  ...WEEKDAYS.map((w) => `(?:(?:on|next)\\s+)?(?:${w})`),
  `${MONTH.replace("(", "(?:")}\\s+\\d{1,2}${ORDINAL}`,
].join("|");
const BARE_HOUR = new RegExp(
  `${L}(${DAY_WORDS})\\s+(\\d{1,2})(?![\\d:.,])(?!\\s*(?:[ap]\\.?m|min|m(?![\\p{L}])|h|hour|hr|day|week|st|nd|rd|th|of))`,
  "iu",
);

export const parseQuickEn = (input: string, now: Date, calendars: QuickCalendar[]): QuickResult => {
  const cut = cutter(input.replace(BARE_HOUR, (_, day: string, hour: string) => `${day} at ${hour}`));
  const tags = takeTags(cut, calendars);
  const date = parseDate(cut, now);
  const time = parseTime(cut, date?.evening ?? false);
  const duration = parseDuration(cut);
  const title = cleanTitle(cut.text, "at|on|from|for|in|to|by");
  return assemble({ title, date: date?.date ?? null, time, duration, ...tags }, now);
};
