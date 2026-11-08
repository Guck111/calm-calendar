// Разбор строки для европейских языков с похожим строем: испанский, французский, португальский,
// немецкий. Порядок тот же, что в русском и английском разборе: распознанные куски вырезаются,
// остаток — название. Язык задаёт только словарь (EuVocab), шаблоны общие.
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

/** Все поля — куски регулярных выражений без захватывающих групп */
export type EuVocab = {
  today: string;
  tomorrow: string;
  dayAfterTomorrow: string;
  /** «сегодня вечером»: голое «в 8» значит 20:00 */
  tonight: string;
  /** «через» перед числом дней или недель */
  inN: string;
  dayUnit: string;
  weekUnit: string;
  /** 12 начал названий месяцев, с января */
  months: string[];
  /** связка между днём и месяцем: «13 de marzo» */
  of?: string;
  /** «13/11» или немецкое «13.11.» (точка в конце обязательна, иначе это время 13.11) */
  numericDate: "slash" | "dot";
  /** 7 дней недели с понедельника */
  weekdays: string[];
  /** артикль или предлог перед днём недели: «el viernes», «am Freitag» */
  on?: string;
  /** «следующий» перед днём недели или после него: «el próximo viernes», «vendredi prochain» */
  nextBefore?: string;
  nextAfter?: string;
  /** предлог перед временем: «a las», «à», «às», «um» */
  at: string;
  from: string;
  to: string;
  /** слово после часа, по которому видно, что это время: «19h», «19 Uhr» */
  hourWord: string;
  /** то же, но только после предлога at: «à 7 heures» (без «à» это длительность) */
  hourWordAfterAt?: string;
  /** части дня: утро — am, день и вечер — pm */
  am: string;
  pm: string;
  noon: string;
  midnight: string;
  /** «на 2 часа», «pendant 2h» */
  forWord: string;
  minute: string;
  hour: string;
  halfHour: string;
  /** что подставить между днём и голым часом: «mañana 9 gym» → «mañana a las 9 gym» */
  atText: string;
  /** предлоги, которые не должны висеть по краям названия */
  prepositions: string;
};

const alt = (xs: string[]) => xs.map((x) => `(?:${x})`).join("|");
const opt = (word: string | undefined) => (word ? `(?:(?:${word})\\s+)?` : "");

export const makeEuParser = (v: EuVocab) => {
  const MONTH = `(${alt(v.months)})[\\p{L}]*\\.?`;
  const monthIndex = (s: string) => v.months.findIndex((m) => new RegExp(`^(?:${m})`, "iu").test(s));
  const OF = v.of ? `(?:\\s+(?:${v.of}))?` : "";
  const YEAR = `(?:,?${OF}\\s+(\\d{4}))?`;
  const DAY = "(0?[1-9]|[12]\\d|3[01])";
  const MON = "(0?[1-9]|1[0-2])";
  const year = (s?: string) => (s ? (s.length === 2 ? 2000 + Number(s) : Number(s)) : null);

  const weekdayRe = (i: number) =>
    re(
      `${opt(v.on)}(?:(${v.nextBefore ?? "(?!)"})\\s+)?(?:${v.weekdays[i]})(?:\\s+(${v.nextAfter ?? "(?!)"}))?`,
    );

  type DateHit = { date: Date; evening?: boolean };

  const parseDate = (cut: Cut, now: Date): DateHit | null => {
    const today = startOfDay(now);
    if (cut.take(re(v.dayAfterTomorrow))) return { date: addDays(today, 2) };
    if (cut.take(re(v.tonight))) return { date: today, evening: true };
    if (cut.take(re(v.tomorrow))) return { date: addDays(today, 1) };
    if (cut.take(re(v.today))) return { date: today };

    const after = cut.take(re(`(?:${v.inN})\\s+(\\d+)\\s+(?:(${v.dayUnit})|(${v.weekUnit}))`));
    if (after) return { date: addDays(today, Number(after[1]) * (after[3] ? 7 : 1)) };

    // «13 de marzo», «13 mars 2027», «13. März»
    const named = cut.take(re(`(\\d{1,2})\\.?${OF}\\s+${MONTH}${YEAR}`));
    if (named && monthIndex(named[2]) >= 0) {
      return { date: upcomingDate(today, monthIndex(named[2]), Number(named[1]), year(named[3])) };
    }

    const numeric = cut.take(
      v.numericDate === "slash"
        ? re(`${DAY}/${MON}(?:/(\\d{4}|\\d{2}))?`)
        : re(`${DAY}\\.${MON}\\.(\\d{4}|\\d{2})?`),
    );
    if (numeric) return { date: upcomingDate(today, Number(numeric[2]) - 1, Number(numeric[1]), year(numeric[3])) };

    // ближайший такой день, включая сегодня; «следующий» — не сегодня
    for (let i = 0; i < v.weekdays.length; i++) {
      const m = cut.take(weekdayRe(i));
      if (m) return { date: nextWeekday(today, i, Boolean(m[1] || m[2])) };
    }
    return null;
  };

  const AT = `(?:(?:${v.at})\\s+)?`;
  const PART = `(?:\\s*(${v.am}|${v.pm}))?`;
  const isPm = (part?: string) => Boolean(part && new RegExp(`^(?:${v.pm})$`, "iu").test(part));
  const isAm = (part?: string) => Boolean(part && new RegExp(`^(?:${v.am})$`, "iu").test(part));

  /** «7 de la tarde» — 19; «12 de la noche» оставляем 12, «12 du matin» — 0 */
  const withPart = (h: number, part: string | undefined, evening: boolean): number => {
    if (isPm(part) || (!part && evening)) return h < 12 ? h + 12 : h;
    if (isAm(part) && h === 12) return 0;
    return h;
  };

  const CLOCK = "(\\d{1,2})(?:[:.h](\\d{2}))?";
  const HW = `(?:\\s*(?:${v.hourWord}))?`;
  const NOT_DURATION = `(?!\\s*(?:${v.minute}|${v.hour}|${v.dayUnit}|${v.weekUnit})(?![\\p{L}]))`;

  const parseTime = (cut: Cut, evening: boolean): TimeRange | null => {
    if (cut.take(re(`${AT}(?:${v.noon})`))) return { h: 12, m: 0 };
    if (cut.take(re(`${AT}(?:${v.midnight})`))) return { h: 0, m: 0 };

    // «de 7 a 9 de la tarde», «19:00-20:30», «von 9 bis 11 Uhr»
    const range = cut.take(
      re(`${opt(v.from)}${CLOCK}${HW}\\s*(?:-|–|—|\\s(?:${v.to})\\s)\\s*${CLOCK}${HW}${PART}`),
    );
    if (range) {
      const [sh, eh] = [Number(range[1]), Number(range[3])];
      const part = range[5];
      // часть дня относится и к началу, если от этого начало не уйдёт за конец («de 11 a 1 de la tarde»)
      const startPart = isPm(part) && sh > eh && sh !== 12 ? undefined : part;
      const h = withPart(sh, startPart, evening);
      const m = Number(range[2] ?? 0);
      const endH = withPart(eh, part, evening);
      const endM = Number(range[4] ?? 0);
      if (validTime(h, m) && validTime(endH, endM)) return { h, m, endH, endM };
    }

    // «19:30», «à 19h30», «um 7.30 Uhr»
    const exact = cut.take(re(`${AT}(\\d{1,2})[:.h](\\d{2})${HW}${PART}`));
    if (exact) {
      const h = withPart(Number(exact[1]), exact[3], evening);
      const m = Number(exact[2]);
      if (validTime(h, m)) return { h, m };
    }
    // «19h», «19 Uhr»
    const marked = cut.take(re(`${AT}(\\d{1,2})\\s*(?:${v.hourWord})${PART}`));
    if (marked) {
      const h = withPart(Number(marked[1]), marked[2], evening);
      if (validTime(h, 0)) return { h, m: 0 };
    }
    // «a las 7», «à 7 heures», «a las 7 de la tarde»
    const afterAt = cut.take(
      re(`(?:${v.at})\\s+(\\d{1,2})${v.hourWordAfterAt ? `(?:\\s*(?:${v.hourWordAfterAt}))?` : ""}${PART}${NOT_DURATION}`),
    );
    if (afterAt) {
      const h = withPart(Number(afterAt[1]), afterAt[2], evening);
      if (validTime(h, 0)) return { h, m: 0 };
    }
    // «7 de la tarde» без предлога
    const parted = cut.take(re(`(\\d{1,2})\\s*(${v.am}|${v.pm})`));
    if (parted) {
      const h = withPart(Number(parted[1]), parted[2], evening);
      if (validTime(h, 0)) return { h, m: 0 };
    }
    return null;
  };

  /** prefixed — только с «на/pendant/für»: такие длительности снимаем до времени, иначе «pendant 2h» станет 02:00 */
  const parseDuration = (cut: Cut, prefixed: boolean): number | null => {
    const FOR = prefixed ? `(?:${v.forWord})\\s+` : opt(v.forWord);
    if (cut.take(re(`${FOR}(?:${v.halfHour})`))) return 30;
    const hm = cut.take(re(`${FOR}(\\d+)\\s*h\\s*(\\d{2})`));
    if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
    const d = cut.take(re(`${FOR}(\\d+(?:[.,]\\d+)?)\\s*(?:(${v.minute})|(${v.hour}))`));
    if (!d) return null;
    const n = Number(d[1].replace(",", "."));
    return Math.round(d[3] ? n * 60 : n);
  };

  // «mañana 9 gimnasio», «vendredi 18 ciné»: число сразу после дня — это час
  const DAY_WORDS = [
    v.today,
    v.tomorrow,
    v.dayAfterTomorrow,
    v.tonight,
    ...v.weekdays.map((w) => `${opt(v.on)}(?:${w})`),
    `\\d{1,2}\\.?${OF}\\s+(?:${alt(v.months)})[\\p{L}]*\\.?`,
  ].join("|");
  const BARE_HOUR = new RegExp(
    `${L}(${DAY_WORDS})\\s+(\\d{1,2})(?![\\d:.,/h])${NOT_DURATION}(?!\\s*(?:${v.hourWord}))${v.of ? `(?!\\s+(?:${v.of})\\s)` : ""}(?!\\.?\\s*(?:${alt(v.months)}))`,
    "iu",
  );

  return (input: string, now: Date, calendars: QuickCalendar[]): QuickResult => {
    const cut = cutter(input.replace(BARE_HOUR, (_, day: string, hour: string) => `${day} ${v.atText} ${hour}`));
    const tags = takeTags(cut, calendars);
    const date = parseDate(cut, now);
    const early = parseDuration(cut, true);
    const time = parseTime(cut, date?.evening ?? false);
    const duration = early ?? parseDuration(cut, false);
    const title = cleanTitle(cut.text, v.prepositions);
    return assemble({ title, date: date?.date ?? null, time, duration, ...tags }, now);
  };
};
