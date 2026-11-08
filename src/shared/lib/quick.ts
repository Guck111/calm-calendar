// Разбор события из одной строки: «завтра 19:00 английский 50 мин #личное @Гдыня»
// или по-английски «tomorrow 7pm English class 50 min #personal». Язык — как у интерфейса.
// Распознанные куски вырезаются из строки, остаток становится названием.
import { lang as uiLang, t, type Lang } from "../i18n";
import { addDays, formatTime, formatWeekdayDayMonth, startOfDay, toDateKey, toTimeKey } from "./date";
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
import { parseQuickEn } from "./quick-en";

export type { QuickCalendar, QuickResult } from "./quick-core";

const MONTHS = ["янв", "фев", "мар", "апр", "ма[йя]", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
/** с понедельника */
const WEEKDAYS = [
  "пн|пон(?:едельник)?",
  "вт|втор(?:ник)?",
  "ср|сред[ау]?",
  "чт|четв(?:ерг)?",
  "пт|пятн(?:иц[ау])?|пятниц[ау]",
  "сб|суб(?:бот[ау])?",
  "вс|воскр(?:есенье)?",
];

const toHour = (h: number, part?: string): number => {
  if (!part) return h;
  const p = part.toLowerCase();
  if ((p.startsWith("веч") || p.startsWith("дня")) && h < 12) return h + 12;
  if (p.startsWith("ноч") && h === 12) return 0;
  return h;
};

const parseDate = (cut: Cut, now: Date): Date | null => {
  const today = startOfDay(now);

  if (cut.take(re("послезавтра"))) return addDays(today, 2);
  if (cut.take(re("завтра"))) return addDays(today, 1);
  if (cut.take(re("сегодня"))) return today;

  const after = cut.take(re("через\\s+(\\d+)\\s+(дн(?:я|ей|ь)|недел(?:ю|и|ь))"));
  if (after) {
    const n = Number(after[1]);
    return addDays(today, after[2].toLowerCase().startsWith("нед") ? n * 7 : n);
  }

  // «5 ноября», «5 нояб»
  const named = cut.take(re(`(\\d{1,2})\\s+(${MONTHS.join("|")})[\\p{L}]*(?:\\s+(\\d{4}))?`));
  if (named) {
    const month = MONTHS.findIndex((m) => new RegExp(`^${m}`, "iu").test(named[2]));
    return upcomingDate(today, month, Number(named[1]), named[3] ? Number(named[3]) : null);
  }

  // «05.11», «5.11.2026» — дата, если месяц от 1 до 12; «в 10.30» — это время, не трогаем
  const dotted = cut.take(re("(?<!в\\s)(0?[1-9]|[12]\\d|3[01])\\.(0?[1-9]|1[0-2])(?:\\.(\\d{4}))?"));
  if (dotted) {
    return upcomingDate(today, Number(dotted[2]) - 1, Number(dotted[1]), dotted[3] ? Number(dotted[3]) : null);
  }

  // «пт», «в пятницу» — ближайший такой день, включая сегодня
  for (let i = 0; i < WEEKDAYS.length; i++) {
    if (cut.take(re(`(?:во?\\s+)?(?:${WEEKDAYS[i]})`))) return nextWeekday(today, i);
  }
  return null;
};

const PART = "(утра|дня|вечера|ночи)";
const CLOCK = "(\\d{1,2})(?:[:.](\\d{2}))?";

const parseTime = (cut: Cut): TimeRange | null => {
  // «с 19 до 21», «19:00-20:30», «19–21»
  const range = cut.take(re(`(?:с\\s+)?${CLOCK}(?:\\s*${PART})?\\s*(?:-|–|—|до)\\s*${CLOCK}(?:\\s*${PART})?`));
  if (range) {
    const h = toHour(Number(range[1]), range[3] ?? range[6]);
    const m = Number(range[2] ?? 0);
    const endH = toHour(Number(range[4]), range[6]);
    const endM = Number(range[5] ?? 0);
    if (validTime(h, m) && validTime(endH, endM)) return { h, m, endH, endM };
  }
  // «19:00», «в 19.30», «в 7 вечера», «в 19»
  const exact = cut.take(re(`(?:в\\s+)?(\\d{1,2})[:.](\\d{2})(?:\\s*${PART})?`));
  if (exact) {
    const h = toHour(Number(exact[1]), exact[3]);
    const m = Number(exact[2]);
    if (validTime(h, m)) return { h, m };
  }
  const short = cut.take(re(`в\\s+(\\d{1,2})(?:\\s*${PART})?(?!\\s*(?:мин|ч))`));
  if (short) {
    const h = toHour(Number(short[1]), short[2]);
    if (validTime(h, 0)) return { h, m: 0 };
  }
  return null;
};

const parseDuration = (cut: Cut): number | null => {
  if (cut.take(re("(?:на\\s+)?полчаса"))) return 30;
  const d = cut.take(re("(?:на\\s+)?(\\d+(?:[.,]\\d+)?)\\s*(мин(?:ут[аы]?)?|м|ч(?:ас(?:а|ов)?)?)"));
  if (!d) return null;
  const n = Number(d[1].replace(",", "."));
  return Math.round(d[2].toLowerCase().startsWith("ч") ? n * 60 : n);
};

// «пт 18 кино», «завтра 9 зарядка»: число сразу после дня — это час
const DAY_WORDS = [
  "сегодня",
  "завтра",
  "послезавтра",
  ...WEEKDAYS.map((w) => `(?:во?\\s+)?(?:${w})`),
  `\\d{1,2}\\s+(?:${MONTHS.join("|")})[\\p{L}]*`,
  "\\d{1,2}\\.\\d{1,2}(?:\\.\\d{4})?",
].join("|");
const BARE_HOUR = new RegExp(
  `${L}(${DAY_WORDS})\\s+(\\d{1,2})(?![\\d:.,])(?!\\s*(?:мин|м${R}|ч|час|дн|недел))`,
  "iu",
);

const parseQuickRu = (input: string, now: Date, calendars: QuickCalendar[]): QuickResult => {
  const cut = cutter(input.replace(BARE_HOUR, (_, day: string, hour: string) => `${day} в ${hour}`));
  const tags = takeTags(cut, calendars);
  const date = parseDate(cut, now);
  const time = parseTime(cut);
  const duration = parseDuration(cut);
  return assemble({ title: cleanTitle(cut.text, "в|во|с|на|до"), date, time, duration, ...tags }, now);
};

export const parseQuick = (
  input: string,
  now: Date,
  calendars: QuickCalendar[] = [],
  language: Lang = uiLang,
): QuickResult => (language === "en" ? parseQuickEn : parseQuickRu)(input, now, calendars);

/** Черновик формы из разобранной строки */
export const quickToDraft = (r: QuickResult, fallbackCalendarId: string) => ({
  calendarId: r.calendarId ?? fallbackCalendarId,
  title: r.title,
  allDay: r.allDay,
  startDate: toDateKey(r.start),
  startTime: toTimeKey(r.start),
  // в форме последний день события на весь день включительно
  endDate: toDateKey(r.allDay ? addDays(r.end, -1) : r.end),
  endTime: toTimeKey(r.end),
  location: r.location ?? "",
  description: "",
  recurring: false,
});

/** «Чт, 5 ноября · 19:00–19:50» для подсказки под строкой */
export const quickWhen = (r: QuickResult): string => {
  const day = formatWeekdayDayMonth(r.start);
  if (r.allDay) return `${day} · ${t.common.allDayLower}`;
  const nextDay = startOfDay(r.end).getTime() !== startOfDay(r.start).getTime();
  return `${day} · ${formatTime(r.start)}–${formatTime(r.end)}${nextDay ? ` ${t.quick.nextDay}` : ""}`;
};
