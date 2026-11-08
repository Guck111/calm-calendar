// Разбор строки для хинди и бенгали. Часть дня стоит перед часом, слово часа — после:
// «शाम 7 बजे», «সন্ধ্যা 7টায়»; «साढ़े 7» — половина восьмого; промежуток — «7 से 9 बजे तक».
// Язык задаёт словарь (IndicVocab), шаблоны общие. Все шаблоны и строка приводятся к NFC.
import { addDays, startOfDay } from "./date";
import {
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

/** Все поля — куски регулярных выражений без захватывающих групп, кроме сказанного */
export type IndicVocab = {
  today: string;
  tomorrow: string;
  dayAfterTomorrow: string;
  /** «сегодня вечером»: «8 बजे» значит 20:00 */
  tonight: string;
  /** одна группа — число: «3 दिन बाद» */
  inDays: string;
  inWeeks: string;
  /** 12 названий месяцев с января (можно с английскими вариантами) */
  months: string[];
  /** окончание числа в дате: бенгальское «৫ই নভেম্বর» */
  ordinal?: string;
  /** 7 дней недели с понедельника */
  weekdays: string[];
  /** что идёт после дня недели: «शुक्रवार को», «শুক্রবারে» */
  weekdaySuffix: string;
  /** «следующий» перед днём недели */
  next: string;
  am: string;
  pm: string;
  /** ночь: 9 — это 21, а 2 — это 2 часа ночи */
  night: string;
  /** слово часа после числа: «बजे», «টায়» */
  hourWord: string;
  /** «половина», «четверть после», «без четверти» перед числом */
  half: string;
  quarterPast: string;
  quarterTo: string;
  /** «полтора», «два с половиной» вместо числа */
  oneAndHalf: string;
  twoAndHalf: string;
  /** между началом и концом промежутка и после конца */
  from: string;
  until: string;
  midnight: string;
  minute: string;
  hour: string;
  halfHour: string;
  /** «для», «на» после длительности */
  forWord: string;
  prepositions: string;
};

type Part = "am" | "pm" | "night";

export const makeIndicParser = (raw: IndicVocab) => {
  const v = Object.fromEntries(
    Object.entries(raw).map(([k, val]) => [k, Array.isArray(val) ? val.map((s) => s.normalize("NFC")) : val.normalize("NFC")]),
  ) as IndicVocab;
  const alt = (xs: string[]) => xs.map((x) => `(?:${x})`).join("|");

  type DateHit = { date: Date; evening?: boolean };

  const MONTH = `(${alt(v.months)})[\\p{L}\\p{M}]*`;
  const monthIndex = (s: string) => v.months.findIndex((m) => new RegExp(`^(?:${m})`, "iu").test(s));
  const ORD = v.ordinal ? `(?:${v.ordinal})?` : "";

  const parseDate = (cut: Cut, now: Date): DateHit | null => {
    const today = startOfDay(now);
    if (cut.take(re(v.dayAfterTomorrow))) return { date: addDays(today, 2) };
    if (cut.take(re(v.tonight))) return { date: today, evening: true };
    if (cut.take(re(v.tomorrow))) return { date: addDays(today, 1) };
    if (cut.take(re(v.today))) return { date: today };

    const days = cut.take(re(v.inDays));
    if (days) return { date: addDays(today, Number(days[1])) };
    const weeks = cut.take(re(v.inWeeks));
    if (weeks) return { date: addDays(today, Number(weeks[1]) * 7) };

    // «5 नवंबर», «৫ই নভেম্বর 2027», «5 Nov»
    const named = cut.take(re(`(\\d{1,2})${ORD}\\s+${MONTH}(?:\\s+(\\d{4}))?`));
    if (named && monthIndex(named[2]) >= 0) {
      return { date: upcomingDate(today, monthIndex(named[2]), Number(named[1]), named[3] ? Number(named[3]) : null) };
    }
    // «12/11» — в Индии и Бангладеш день впереди
    const numeric = cut.take(re("(0?[1-9]|[12]\\d|3[01])/(0?[1-9]|1[0-2])(?:/(\\d{4}))?"));
    if (numeric) {
      return { date: upcomingDate(today, Number(numeric[2]) - 1, Number(numeric[1]), numeric[3] ? Number(numeric[3]) : null) };
    }

    for (let i = 0; i < v.weekdays.length; i++) {
      const m = cut.take(re(`(?:(${v.next})\\s+)?(?:${v.weekdays[i]})(?:${v.weekdaySuffix})?`));
      if (m) return { date: nextWeekday(today, i, Boolean(m[1])) };
    }
    return null;
  };

  const NUM = `(?:\\d{1,2}(?::\\d{2})?|${v.oneAndHalf}|${v.twoAndHalf})`;
  const NOT_DURATION = `(?!\\s*(?:${v.minute}|${v.hour})(?![\\p{L}\\p{M}]))`;
  const CLOCK = `(?:(?:${v.am}|${v.pm}|${v.night})\\s*)?(?:(?:${v.half}|${v.quarterPast}|${v.quarterTo})\\s*)?${NUM}${NOT_DURATION}(?:\\s*(?:${v.hourWord}))?`;
  const ONE = new RegExp(
    `^(?:(${v.am})|(${v.pm})|(${v.night}))?\\s*(?:(${v.half})|(${v.quarterPast})|(${v.quarterTo}))?\\s*` +
      `(?:(\\d{1,2})(?::(\\d{2}))?|(${v.oneAndHalf})|(${v.twoAndHalf}))\\s*(${v.hourWord})?$`,
    "iu",
  );

  type Clock = { h: number; m: number; part?: Part; marked: boolean };

  const readClock = (s: string): Clock | null => {
    const g = s.trim().match(ONE);
    if (!g) return null;
    const part: Part | undefined = g[1] ? "am" : g[2] ? "pm" : g[3] ? "night" : undefined;
    let h = Number(g[7] ?? 0);
    let m = Number(g[8] ?? 0);
    if (g[9]) [h, m] = [1, 30];
    if (g[10]) [h, m] = [2, 30];
    if (g[4]) m = 30;
    if (g[5]) m = 15;
    if (g[6]) [h, m] = [h - 1, 45];
    // голое число — не время; «डेढ़» без «बजे» — скорее длительность
    const marked = Boolean(part || g[4] || g[5] || g[6] || g[8] !== undefined || g[11]);
    return { h, m, part, marked };
  };

  const to24 = (h: number, part: Part | undefined, evening: boolean): number => {
    if (part === "pm") return h < 12 ? h + 12 : h;
    if (part === "am") return h === 12 ? 0 : h;
    if (part === "night" || evening) {
      if (h === 12) return 0;
      return h >= 6 && h < 12 ? h + 12 : h;
    }
    return h;
  };

  const parseTime = (cut: Cut, evening: boolean): TimeRange | null => {
    if (cut.take(re(v.midnight))) return { h: 0, m: 0 };

    const pair = (m: RegExpMatchArray) => [readClock(m[1]), readClock(m[2])] as const;
    const range = cut.takeWhere(
      re(`(${CLOCK})\\s*(?:${v.from}|-|–|—)\\s*(${CLOCK})(?:\\s*(?:${v.until}))?`),
      (m) => {
        const [a, b] = pair(m);
        return Boolean(a && b && (a.marked || b.marked));
      },
    );
    if (range) {
      const [a, b] = pair(range);
      if (a && b) {
        const h = to24(a.h, a.part ?? b.part, evening);
        const endH = to24(b.h, b.part ?? a.part, evening);
        if (validTime(h, a.m) && validTime(endH, b.m)) return { h, m: a.m, endH, endM: b.m };
      }
    }

    const one = cut.takeWhere(re(CLOCK), (m) => Boolean(readClock(m[0])?.marked));
    if (one) {
      const c = readClock(one[0]);
      if (c) {
        const h = to24(c.h, c.part, evening);
        if (validTime(h, c.m)) return { h, m: c.m };
      }
    }
    return null;
  };

  const parseDuration = (cut: Cut): number | null => {
    const FOR = `(?:\\s*(?:${v.forWord}))?`;
    if (cut.take(re(`(?:${v.halfHour})${FOR}`))) return 30;
    const special = cut.take(re(`(?:(${v.oneAndHalf})|(${v.twoAndHalf}))\\s*(?:${v.hour})${FOR}`));
    if (special) return special[1] ? 90 : 150;
    const halfPast = cut.take(re(`(?:${v.half})\\s*(\\d+)\\s*(?:${v.hour})${FOR}`));
    if (halfPast) return Number(halfPast[1]) * 60 + 30;
    const d = cut.take(re(`(\\d+(?:[.,]\\d+)?)\\s*(?:(${v.minute})|(${v.hour}))${FOR}`));
    if (!d) return null;
    const n = Number(d[1].replace(",", "."));
    return Math.round(d[3] ? n * 60 : n);
  };

  return (input: string, now: Date, calendars: QuickCalendar[]): QuickResult => {
    const cut = cutter(input);
    const tags = takeTags(cut, calendars);
    const date = parseDate(cut, now);
    const time = parseTime(cut, date?.evening ?? false);
    const duration = parseDuration(cut);
    const title = cleanTitle(cut.text, v.prepositions);
    return assemble({ title, date: date?.date ?? null, time, duration, ...tags }, now);
  };
};
