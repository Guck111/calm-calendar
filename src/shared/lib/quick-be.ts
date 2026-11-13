// Беларускі разбор радка: «заўтра а 19:00 англійская 50 хв #асабістае @Мінск».
// Уладкаваны як рускі (quick-ru.ts): пазнаныя кавалкі выразаюцца, астатняе — назва.
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

const MONTHS = ["студз", "лют", "сак", "крас", "ма[йя]", "чэрв", "ліп", "жн", "вер", "каст", "ліст", "снеж"];
/** з панядзелка */
const WEEKDAYS = [
  "пн|пан(?:ядзел(?:ак|ка))?",
  "аў|аўт(?:ор(?:ак|ка))?",
  "ср|серад[аыу]?",
  "чц|чт|чацв(?:ер(?:га)?)?",
  "пт|пятн(?:іц[аыу])?|пятніц[аыу]",
  "сб|суб(?:от[аыу])?",
  "нд|нядз(?:ел[яюі])?",
];

/** «у» пасля галоснай пішуць «ў» */
const IN = "[уўв]";

const toHour = (h: number, part?: string): number => {
  if (!part) return h;
  const p = part.toLowerCase();
  if ((p.startsWith("веч") || p.startsWith("дня")) && h < 12) return h + 12;
  if (p.startsWith("ноч") && h === 12) return 0;
  return h;
};

/** Чысло месяца без месяца: у гэтым месяцы, а калі ўжо прайшло — у наступным */
const monthDay = (today: Date, day: number): Date | null => {
  for (const shift of [0, 1, 2]) {
    const d = new Date(today.getFullYear(), today.getMonth() + shift, day);
    if (d.getDate() === day && d >= today) return d;
  }
  return null;
};

const parseDate = (cut: Cut, now: Date): Date | null => {
  const today = startOfDay(now);

  if (cut.take(re("паслязаўтра"))) return addDays(today, 2);
  if (cut.take(re("заўтра"))) return addDays(today, 1);
  if (cut.take(re("сёння"))) return today;

  const after = cut.take(re("праз\\s+(\\d+)\\s+(дн(?:і|яў)|дзень|дзён|тыд(?:зень|ні|няў))"));
  if (after) {
    const n = Number(after[1]);
    return addDays(today, after[2].toLowerCase().startsWith("тыд") ? n * 7 : n);
  }

  // «5 лістапада», «5 ліст»
  const named = cut.take(re(`(\\d{1,2})\\s+(${MONTHS.join("|")})[\\p{L}]*(?:\\s+(\\d{4}))?`));
  if (named) {
    const month = MONTHS.findIndex((m) => new RegExp(`^${m}`, "iu").test(named[2]));
    return upcomingDate(today, month, Number(named[1]), named[3] ? Number(named[3]) : null);
  }

  // «05.11», «5.11.2026»; «а 10.30» — гэта час
  const dotted = cut.take(re(`(?<!(?:а|${IN})\\s)(0?[1-9]|[12]\\d|3[01])\\.(0?[1-9]|1[0-2])(?:\\.(\\d{4}))?`));
  if (dotted) {
    return upcomingDate(today, Number(dotted[2]) - 1, Number(dotted[1]), dotted[3] ? Number(dotted[3]) : null);
  }

  // «14-га», «14 чысла», «…, 14» напрыканцы
  const day = cut.take(re("(\\d{1,2})(?:-?га|\\s+чысла)")) ?? cut.take(/,\s*(\d{1,2})\s*$/u);
  if (day) {
    const d = monthDay(today, Number(day[1]));
    if (d) return d;
  }

  // «пт», «у пятніцу» — бліжэйшы такі дзень, уключна з сённяшнім
  for (let i = 0; i < WEEKDAYS.length; i++) {
    if (cut.take(re(`(?:${IN}\\s+)?(?:${WEEKDAYS[i]})`))) return nextWeekday(today, i);
  }
  return null;
};

const PART = "(раніцы|дня|вечара|ночы)";
const CLOCK = "(\\d{1,2})(?:[:.](\\d{2}))?";

const parseTime = (cut: Cut): TimeRange | null => {
  // «з 19 да 21», «19:00-20:30»
  const range = cut.take(re(`(?:(?:з|ад)\\s+)?${CLOCK}(?:\\s*${PART})?\\s*(?:-|–|—|да)\\s*${CLOCK}(?:\\s*${PART})?`));
  if (range) {
    const h = toHour(Number(range[1]), range[3] ?? range[6]);
    const m = Number(range[2] ?? 0);
    const endH = toHour(Number(range[4]), range[6]);
    const endM = Number(range[5] ?? 0);
    if (validTime(h, m) && validTime(endH, endM)) return { h, m, endH, endM };
  }
  // «19:00», «а 19.30»
  const exact = cut.take(re(`(?:(?:а|${IN})\\s+)?(\\d{1,2})[:.](\\d{2})(?:\\s*${PART})?`));
  if (exact) {
    const h = toHour(Number(exact[1]), exact[3]);
    const m = Number(exact[2]);
    if (validTime(h, m)) return { h, m };
  }
  // «а 7 вечара», «у 19»
  const short = cut.take(re(`(?:а|${IN})\\s+(\\d{1,2})(?:\\s*${PART})?(?!\\s*(?:хв|гадз|г${R}))`));
  if (short) {
    const h = toHour(Number(short[1]), short[2]);
    if (validTime(h, 0)) return { h, m: 0 };
  }
  return null;
};

const parseDuration = (cut: Cut): number | null => {
  if (cut.take(re("(?:на\\s+)?паўгадзіны"))) return 30;
  const d = cut.take(re("(?:на\\s+)?(\\d+(?:[.,]\\d+)?)\\s*(хв(?:ілін[аыу]?)?|м|гадз(?:ін[аыу]?)?|г)"));
  if (!d) return null;
  const n = Number(d[1].replace(",", "."));
  return Math.round(d[2].toLowerCase().startsWith("г") ? n * 60 : n);
};

// «пт 18 кіно», «заўтра 9 зарадка»: лік адразу пасля дня — гэта гадзіна
const DAY_WORDS = [
  "сёння",
  "заўтра",
  "паслязаўтра",
  ...WEEKDAYS.map((w) => `(?:${IN}\\s+)?(?:${w})`),
  `\\d{1,2}\\s+(?:${MONTHS.join("|")})[\\p{L}]*`,
  "\\d{1,2}\\.\\d{1,2}(?:\\.\\d{4})?",
].join("|");
const BARE_HOUR = new RegExp(
  `${L}(${DAY_WORDS})\\s+(\\d{1,2})(?![\\d:.,])(?!\\s*(?:хв|м${R}|г${R}|гадз|дн|дзён|тыд))`,
  "iu",
);

export const parseQuickBe = (input: string, now: Date, calendars: QuickCalendar[]): QuickResult => {
  const cut = cutter(input.replace(BARE_HOUR, (_, day: string, hour: string) => `${day} а ${hour}`));
  const tags = takeTags(cut, calendars);
  const date = parseDate(cut, now);
  const time = parseTime(cut);
  const duration = parseDuration(cut);
  return assemble({ title: cleanTitle(cut.text, "у|ў|в|а|з|ад|на|да"), date, time, duration, ...tags }, now);
};
