// Разбор события из одной строки: «завтра 19:00 английский 50 мин #личное @Гдыня».
// Распознанные куски вырезаются из строки, остаток становится названием.
import { addDays, addMinutes, startOfDay, toDateKey, toTimeKey, weekdayIndex } from "./date";

export type QuickCalendar = { id: string; name: string };

export type QuickResult = {
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  calendarId?: string;
  location?: string;
};

// \b в JS не понимает кириллицу, поэтому границы слова — через юникод-классы
const L = "(?<![\\p{L}\\d])";
const R = "(?![\\p{L}\\d])";
const re = (body: string) => new RegExp(`${L}${body}${R}`, "iu");

const MONTHS = ["янв", "фев", "мар", "апр", "ма[йя]", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const WEEKDAYS = [
  "пн|пон(?:едельник)?",
  "вт|втор(?:ник)?",
  "ср|сред[ау]?",
  "чт|четв(?:ерг)?",
  "пт|пятн(?:иц[ау])?|пятниц[ау]",
  "сб|суб(?:бот[ау])?",
  "вс|воскр(?:есенье)?",
];

const DEFAULT_MINUTES = 60;

type Cut = { text: string; take: (r: RegExp) => RegExpMatchArray | null };

const cutter = (input: string): Cut => {
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

const toHour = (h: number, part?: string): number => {
  if (!part) return h;
  const p = part.toLowerCase();
  if ((p.startsWith("веч") || p.startsWith("дня")) && h < 12) return h + 12;
  if (p.startsWith("ноч") && h === 12) return 0;
  return h;
};

const validTime = (h: number, m: number) => h >= 0 && h <= 23 && m >= 0 && m <= 59;

const withTime = (day: Date, h: number, m: number) =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);

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
    const explicitYear = named[3] ? Number(named[3]) : null;
    const d = new Date(explicitYear ?? today.getFullYear(), month, Number(named[1]));
    return !explicitYear && d < today ? new Date(d.getFullYear() + 1, month, d.getDate()) : d;
  }

  // «05.11», «5.11.2026» — дата, если месяц от 1 до 12; «в 10.30» — это время, не трогаем
  const dotted = cut.take(re("(?<!в\\s)(0?[1-9]|[12]\\d|3[01])\\.(0?[1-9]|1[0-2])(?:\\.(\\d{4}))?"));
  if (dotted) {
    const [day, month] = [Number(dotted[1]), Number(dotted[2])];
    const explicitYear = dotted[3] ? Number(dotted[3]) : null;
    const d = new Date(explicitYear ?? today.getFullYear(), month - 1, day);
    return !explicitYear && d < today ? new Date(d.getFullYear() + 1, month - 1, day) : d;
  }

  // «пт», «в пятницу» — ближайший такой день, включая сегодня
  for (let i = 0; i < WEEKDAYS.length; i++) {
    if (cut.take(re(`(?:во?\\s+)?(?:${WEEKDAYS[i]})`))) {
      return addDays(today, (i - weekdayIndex(today) + 7) % 7);
    }
  }
  return null;
};

const PART = "(утра|дня|вечера|ночи)";
const CLOCK = "(\\d{1,2})(?:[:.](\\d{2}))?";

type TimeRange = { h: number; m: number; endH?: number; endM?: number };

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

const findCalendar = (tag: string, calendars: QuickCalendar[]): string | undefined => {
  const t = tag.toLowerCase();
  const byStart = calendars.find((c) => c.name.toLowerCase().startsWith(t));
  return (byStart ?? calendars.find((c) => c.name.toLowerCase().includes(t)))?.id;
};

const cleanTitle = (text: string): string =>
  text
    .replace(/\s+/g, " ")
    .trim()
    // висящие предлоги по краям после вырезания даты и времени
    .replace(/^(?:в|во|с|на|до)\s+/iu, "")
    .replace(/\s+(?:в|во|с|на|до)$/iu, "")
    .trim();

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

export const parseQuick = (input: string, now: Date, calendars: QuickCalendar[] = []): QuickResult => {
  const cut = cutter(input.replace(BARE_HOUR, (_, day: string, hour: string) => `${day} в ${hour}`));

  const tag = cut.take(/(?:^|\s)#(\S+)/u);
  const calendarId = tag ? findCalendar(tag[1], calendars) : undefined;
  const place = cut.take(/(?:^|\s)@(\S+)/u);
  const location = place ? place[1].replace(/_/g, " ") : undefined;

  const date = parseDate(cut, now);
  const time = parseTime(cut);
  const duration = parseDuration(cut);
  const title = cleanTitle(cut.text);

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
  const day = new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "long" }).format(r.start);
  const cap = day.charAt(0).toUpperCase() + day.slice(1);
  if (r.allDay) return `${cap} · весь день`;
  const t = (d: Date) => toTimeKey(d);
  const nextDay = startOfDay(r.end).getTime() !== startOfDay(r.start).getTime();
  return `${cap} · ${t(r.start)}–${t(r.end)}${nextDay ? " (на следующий день)" : ""}`;
};
