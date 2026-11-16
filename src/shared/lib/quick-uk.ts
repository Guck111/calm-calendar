// Ukrainian phrase parsing: «завтра о 19:00 англійська 50 хв #особисте @Київ».
// Built like the Russian one (quick-ru.ts): recognized pieces are cut out, the rest is the title.
import { addDays, startOfDay } from "./date";
import {
  L,
  R,
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

/** the apostrophe is written with three characters, and often skipped: «п'ятниця», «п’ятниця», «пʼятниця», «пятниця» */
const APOS = "['’ʼ]?";

const MONTHS = ["січ", "лют", "бер", "квіт", "трав", "черв", "лип", "серп", "вер", "жовт", "лист", "груд"];
/** from Monday */
const WEEKDAYS = [
  "пн|пон(?:еділ(?:ок|ка))?",
  "вт|вів(?:тор(?:ок|ка))?",
  "ср|серед[аиу]?",
  "чт|четв(?:ер(?:га)?)?",
  `пт|п${APOS}ятн(?:иц[яюі])?|п${APOS}ятниц[яюі]`,
  "сб|суб(?:от[аиу])?",
  "нд|нед(?:іл[яюі])?",
];

const toHour = (h: number, part?: string): number => {
  if (!part) return h;
  const p = part.toLowerCase();
  if ((p.startsWith("веч") || p.startsWith("дня")) && h < 12) return h + 12;
  if (p.startsWith("ноч") && h === 12) return 0;
  return h;
};

/** Day of month without a month: in this month, and if it has passed — in the next one */
const monthDay = (today: Date, day: number): Date | null => {
  for (const shift of [0, 1, 2]) {
    const d = new Date(today.getFullYear(), today.getMonth() + shift, day);
    if (d.getDate() === day && d >= today) return d;
  }
  return null;
};

const parseDate = (cut: Cut, now: Date): Date | null => {
  const today = startOfDay(now);

  if (cut.take(re("післязавтра"))) return addDays(today, 2);
  if (cut.take(re("завтра"))) return addDays(today, 1);
  if (cut.take(re("сьогодні"))) return today;

  const after = cut.take(re("(?:через|за)\\s+(\\d+)\\s+(дн(?:і|ів)|день|тиж(?:день|ні|нів))"));
  if (after) {
    const n = Number(after[1]);
    return addDays(today, after[2].toLowerCase().startsWith("тиж") ? n * 7 : n);
  }

  // «5 листопада», «5 лист»
  const named = cut.take(re(`(\\d{1,2})\\s+(${MONTHS.join("|")})[\\p{L}]*(?:\\s+(\\d{4}))?`));
  if (named) {
    const month = MONTHS.findIndex((m) => new RegExp(`^${m}`, "iu").test(named[2]));
    return upcomingDate(today, month, Number(named[1]), named[3] ? Number(named[3]) : null);
  }

  // «05.11», «5.11.2026»; «о 10.30» is a time
  const dotted = cut.take(re("(?<!(?:о|об)\\s)(0?[1-9]|[12]\\d|3[01])\\.(0?[1-9]|1[0-2])(?:\\.(\\d{4}))?"));
  if (dotted) {
    return upcomingDate(today, Number(dotted[2]) - 1, Number(dotted[1]), dotted[3] ? Number(dotted[3]) : null);
  }

  // «14-го», «14 числа», «…, 14» at the end
  const day = cut.take(re("(\\d{1,2})(?:-?го|\\s+числа)")) ?? cut.take(/,\s*(\d{1,2})\s*$/u);
  if (day) {
    const d = monthDay(today, Number(day[1]));
    if (d) return d;
  }

  // «пт», «у п'ятницю» — the nearest such day, including today
  for (let i = 0; i < WEEKDAYS.length; i++) {
    if (cut.take(re(`(?:[ув]\\s+)?(?:${WEEKDAYS[i]})`))) return nextWeekday(today, i);
  }
  return null;
};

const PART = "(ранку|дня|вечора|ночі)";
const CLOCK = "(\\d{1,2})(?:[:.](\\d{2}))?";

const parseTime = (cut: Cut): TimeRange | null => {
  // «з 19 до 21», «19:00-20:30»
  const range = cut.take(re(`(?:(?:з|із|від)\\s+)?${CLOCK}(?:\\s*${PART})?\\s*(?:-|–|—|до)\\s*${CLOCK}(?:\\s*${PART})?`));
  if (range) {
    const h = toHour(Number(range[1]), range[3] ?? range[6]);
    const m = Number(range[2] ?? 0);
    const endH = toHour(Number(range[4]), range[6]);
    const endM = Number(range[5] ?? 0);
    if (validTime(h, m) && validTime(endH, endM)) return { h, m, endH, endM };
  }
  // «19:00», «о 19.30»
  const exact = cut.take(re(`(?:(?:о|об|в|у)\\s+)?(\\d{1,2})[:.](\\d{2})(?:\\s*${PART})?`));
  if (exact) {
    const h = toHour(Number(exact[1]), exact[3]);
    const m = Number(exact[2]);
    if (validTime(h, m)) return { h, m };
  }
  // «о 7 вечора», «об 11»
  const short = cut.take(re(`(?:о|об)\\s+(\\d{1,2})(?:\\s*${PART})?(?!\\s*(?:хв|год|г${R}))`));
  if (short) {
    const h = toHour(Number(short[1]), short[2]);
    if (validTime(h, 0)) return { h, m: 0 };
  }
  return null;
};

const parseDuration = (cut: Cut): number | null => {
  if (cut.take(re("(?:на\\s+)?півгодини"))) return 30;
  const d = cut.take(re("(?:на\\s+)?(\\d+(?:[.,]\\d+)?)\\s*(хв(?:илин[аиу]?)?|м|год(?:ин[аиу]?)?|г)"));
  if (!d) return null;
  const n = Number(d[1].replace(",", "."));
  return Math.round(d[2].toLowerCase().startsWith("г") ? n * 60 : n);
};

// «пт 18 кіно», «завтра 9 зарядка»: a number right after the day is the hour
const DAY_WORDS = [
  "сьогодні",
  "завтра",
  "післязавтра",
  ...WEEKDAYS.map((w) => `(?:[ув]\\s+)?(?:${w})`),
  `\\d{1,2}\\s+(?:${MONTHS.join("|")})[\\p{L}]*`,
  "\\d{1,2}\\.\\d{1,2}(?:\\.\\d{4})?",
].join("|");
const BARE_HOUR = new RegExp(
  `${L}(${DAY_WORDS})\\s+(\\d{1,2})(?![\\d:.,])(?!\\s*(?:хв|м${R}|г${R}|год|дн|тиж))`,
  "iu",
);

export const parseQuickUk = (input: string, now: Date, calendars: QuickCalendar[]): QuickResult => {
  const cut = cutter(input.replace(BARE_HOUR, (_, day: string, hour: string) => `${day} о ${hour}`));
  const tags = takeTags(cut, calendars);
  const date = parseDate(cut, now);
  const time = parseTime(cut);
  const duration = parseDuration(cut);
  return assemble({ title: cleanTitle(cut.text, "у|в|о|об|з|із|від|на|до"), date, time, duration, ...tags }, now);
};
