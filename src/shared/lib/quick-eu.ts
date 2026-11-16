// Phrase parsing for European languages with a similar structure: Spanish, French, Portuguese,
// German. The order is the same as in the Russian and English parsers: recognized pieces are cut out,
// the rest is the title. The language provides only the vocabulary (EuVocab), the patterns are shared.
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

/** All fields are pieces of regular expressions without capturing groups */
export type EuVocab = {
  today: string;
  tomorrow: string;
  dayAfterTomorrow: string;
  /** "this evening": a bare "at 8" means 20:00 */
  tonight: string;
  /** "in" before a number of days or weeks */
  inN: string;
  dayUnit: string;
  weekUnit: string;
  /** 12 month name prefixes, from January */
  months: string[];
  /** link between day and month: «13 de marzo» */
  of?: string;
  /** ordinal suffix: «1er mars» */
  ordinal?: string;
  /** «13/11» or German «13.11.» (the trailing period is required, otherwise it's the time 13.11) */
  numericDate: "slash" | "dot";
  /** 7 weekdays from Monday */
  weekdays: string[];
  /** article or preposition before a weekday: «el viernes», «am Freitag» */
  on?: string;
  /** "next" before or after a weekday: «el próximo viernes», «vendredi prochain» */
  nextBefore?: string;
  nextAfter?: string;
  /** preposition before a time: «a las», «à», «às», «um» */
  at: string;
  from: string;
  to: string;
  /** word after the hour that shows it's a time: «19h», «19 Uhr» */
  hourWord: string;
  /** the same, but only after the "at" preposition: «à 7 heures» (without «à» it's a duration) */
  hourWordAfterAt?: string;
  /** parts of the day: morning — am, afternoon and evening — pm */
  am: string;
  pm: string;
  noon: string;
  midnight: string;
  /** "for 2 hours", «pendant 2h» */
  forWord: string;
  minute: string;
  hour: string;
  halfHour: string;
  /** what to insert between a day and a bare hour: «mañana 9 gym» → «mañana a las 9 gym» */
  atText: string;
  /** prepositions that mustn't dangle at the edges of the title */
  prepositions: string;
};

const alt = (xs: string[]) => xs.map((x) => `(?:${x})`).join("|");
const opt = (word: string | undefined) => (word ? `(?:(?:${word})\\s+)?` : "");

export const makeEuParser = (v: EuVocab) => {
  const MONTH = `(${alt(v.months)})[\\p{L}]*\\.?`;
  const monthIndex = (s: string) => v.months.findIndex((m) => new RegExp(`^(?:${m})`, "iu").test(s));
  const OF = v.of ? `(?:\\s+(?:${v.of}))?` : "";
  const YEAR = `(?:,?${OF}\\s+(\\d{4}))?`;
  const ORD = v.ordinal ? `(?:${v.ordinal})?` : "";
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
    const named = cut.take(re(`(\\d{1,2})${ORD}\\.?${OF}\\s+${MONTH}${YEAR}`));
    if (named && monthIndex(named[2]) >= 0) {
      return { date: upcomingDate(today, monthIndex(named[2]), Number(named[1]), year(named[3])) };
    }

    const numeric = cut.take(
      v.numericDate === "slash"
        ? re(`${DAY}/${MON}(?:/(\\d{4}|\\d{2}))?`)
        : re(`${DAY}\\.${MON}\\.(\\d{4}|\\d{2})?`),
    );
    if (numeric) return { date: upcomingDate(today, Number(numeric[2]) - 1, Number(numeric[1]), year(numeric[3])) };

    // the nearest such day, including today; "next" — not today
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

  /** «7 de la tarde» is 19; «12 de la noche» stays 12, «12 du matin» is 0 */
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
      // the part of day applies to the start too, if that doesn't push the start past the end («de 11 a 1 de la tarde»)
      const startPart = isPm(part) && sh > eh && sh !== 12 ? undefined : part;
      const h = withPart(sh, startPart, evening);
      const m = Number(range[2] ?? 0);
      const endH = withPart(eh, part, evening);
      const endM = Number(range[4] ?? 0);
      if (validTime(h, m) && validTime(endH, endM)) return { h, m, endH, endM };
    }

    // A single time. Take what comes earlier in the string: «9h sport 1h30» is 9:00 and an hour and a half.
    const singles: [RegExp, (m: RegExpMatchArray) => [number, number]][] = [
      // «19:30», «à 19h30», «um 7.30 Uhr»
      [re(`${AT}(\\d{1,2})[:.h](\\d{2})${HW}${PART}`), (m) => [withPart(Number(m[1]), m[3], evening), Number(m[2])]],
      // «19h», «19 Uhr»
      [re(`${AT}(\\d{1,2})\\s*(?:${v.hourWord})${PART}`), (m) => [withPart(Number(m[1]), m[2], evening), 0]],
      // «a las 7», «à 7 heures», «a las 7 de la tarde»
      [
        re(`(?:${v.at})\\s+(\\d{1,2})${v.hourWordAfterAt ? `(?:\\s*(?:${v.hourWordAfterAt}))?` : ""}${PART}${NOT_DURATION}`),
        (m) => [withPart(Number(m[1]), m[2], evening), 0],
      ],
      // «7 de la tarde» without a preposition
      [re(`(\\d{1,2})\\s*(${v.am}|${v.pm})`), (m) => [withPart(Number(m[1]), m[2], evening), 0]],
    ];
    const found = singles
      .map(([r, read]) => ({ r, read, at: cut.text.match(r)?.index }))
      .filter((x): x is typeof x & { at: number } => x.at !== undefined)
      .sort((a, b) => a.at - b.at);
    for (const { r, read } of found) {
      const m = cut.take(r);
      if (!m) continue;
      const [h, min] = read(m);
      if (validTime(h, min)) return { h, m: min };
    }
    return null;
  };

  /** prefixed — only with «на/pendant/für»: such durations are removed before the time, otherwise «pendant 2h» would become 02:00 */
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

  // «mañana 9 gimnasio», «vendredi 18 ciné»: a number right after the day is the hour
  const DAY_WORDS = [
    v.today,
    v.tomorrow,
    v.dayAfterTomorrow,
    v.tonight,
    ...v.weekdays.map((w) => `${opt(v.on)}(?:${w})`),
    `\\d{1,2}${ORD}\\.?${OF}\\s+(?:${alt(v.months)})[\\p{L}]*\\.?`,
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
