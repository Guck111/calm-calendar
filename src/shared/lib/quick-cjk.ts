// Разбор строки для японского и китайского: слова пишутся слитно, поэтому без границ слов;
// часть дня стоит перед часом («午後7時», «下午3点»), числа бывают иероглифами («三点半»).
// Язык задаёт словарь (CjkVocab), шаблоны общие.
import { addDays, startOfDay } from "./date";
import {
  assemble,
  cutter,
  mondayIndex,
  nextWeekday,
  takeTags,
  upcomingDate,
  validTime,
  type Cut,
  type QuickCalendar,
  type QuickResult,
  type TimeRange,
} from "./quick-core";

/** Все поля — куски регулярных выражений; захватывающие группы только там, где сказано */
export type CjkVocab = {
  today: string;
  tomorrow: string;
  dayAfterTomorrow: string;
  /** «сегодня вечером»: «8時» значит 20:00 */
  tonight: string;
  /** одна группа — число: «3日後», «3天后» */
  inDays: string;
  inWeeks: string;
  /** окончание дня в дате: «5日», «5号» */
  daySuffix: string;
  /** день недели: группа 1 — «на следующей неделе», группа 2 — знак дня */
  weekday: string;
  /** знаки дней с понедельника, каждый — класс символов */
  weekdayChars: string[];
  /** слово часа: «時», «点» */
  hour: string;
  /** части дня перед часом */
  am: string;
  pm: string;
  noon: string;
  /** между началом и концом промежутка */
  rangeSep: string;
  /** после конца промежутка: «まで» */
  rangeEnd?: string;
  durMinute: string;
  durHour: string;
  /** «полчаса» */
  halfHour: string;
  /** «1時間半», «一个半小时»: группа — число часов */
  hourAndHalf: string;
  /** частицы, которые не остаются в названии отдельным куском */
  particles: string;
  /** частицы, которые срезаются с краёв кусков названия: японское «に会議» → «会議».
   *  В китайском не нужны: «在家办公» начинается с «在» по смыслу */
  edgeParticles?: string;
};

const DIGITS: Record<string, number> = {
  〇: 0, 零: 0, 一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

/** «十二» → 12, «二十三» → 23, «两» → 2; до 99 хватает для часов, дней и месяцев */
const kanjiNumber = (s: string): number => {
  const ten = s.indexOf("十");
  if (ten < 0) return [...s].reduce((n, ch) => n * 10 + DIGITS[ch], 0);
  const tens = ten === 0 ? 1 : DIGITS[s[ten - 1]];
  const ones = ten === s.length - 1 ? 0 : DIGITS[s[ten + 1]];
  return tens * 10 + ones;
};

// числа иероглифами меняем на цифры только перед единицами времени: «三点», «十二月», «两个小时»;
// «星期一» и «一个人» не трогаем
const KANJI_NUMBER = new RegExp(
  "([〇零一二两兩三四五六七八九]?十[一二三四五六七八九]?|[〇零一二两兩三四五六七八九]{1,2})" +
    "(?=\\s*(?:点|點|時|时|分|月|日|号|號|天|周|週|年|半|个?小时|個?小時|个半|個半|星期|礼拜|禮拜))",
  "gu",
);

export const kanjiToDigits = (s: string): string => s.replace(KANJI_NUMBER, (n) => String(kanjiNumber(n)));

export const makeCjkParser = (v: CjkVocab) => {
  const rx = (body: string) => new RegExp(body, "iu");

  type DateHit = { date: Date; evening?: boolean };

  const parseDate = (cut: Cut, now: Date): DateHit | null => {
    const today = startOfDay(now);
    if (cut.take(rx(v.dayAfterTomorrow))) return { date: addDays(today, 2) };
    if (cut.take(rx(v.tonight))) return { date: today, evening: true };
    if (cut.take(rx(v.tomorrow))) return { date: addDays(today, 1) };
    if (cut.take(rx(v.today))) return { date: today };

    const days = cut.take(rx(v.inDays));
    if (days) return { date: addDays(today, Number(days[1])) };
    const weeks = cut.take(rx(v.inWeeks));
    if (weeks) return { date: addDays(today, Number(weeks[1]) * 7) };

    // «2027年3月5日», «11月5号», «11/5» (месяц впереди)
    const full = cut.take(rx(`(?:(\\d{4})\\s*年\\s*)?(\\d{1,2})\\s*月\\s*(\\d{1,2})\\s*(?:${v.daySuffix})`));
    if (full) return { date: upcomingDate(today, Number(full[2]) - 1, Number(full[3]), full[1] ? Number(full[1]) : null) };
    const slash = cut.take(rx("(?<!\\d)(1[0-2]|0?[1-9])/(3[01]|[12]\\d|0?[1-9])(?!\\d)"));
    if (slash) return { date: upcomingDate(today, Number(slash[1]) - 1, Number(slash[2]), null) };

    // «5号», «5日»: ближайшее такое число — в этом месяце или в следующем
    const dayOnly = cut.take(rx(`(?<![\\d月/])(3[01]|[12]\\d|0?[1-9])\\s*(?:${v.daySuffix})(?![間间后後以前])`));
    if (dayOnly) {
      const day = Number(dayOnly[1]);
      const thisMonth = new Date(today.getFullYear(), today.getMonth(), day);
      return { date: thisMonth < today ? new Date(today.getFullYear(), today.getMonth() + 1, day) : thisMonth };
    }

    const wd = cut.take(rx(v.weekday));
    if (wd) {
      const i = v.weekdayChars.findIndex((c) => new RegExp(`^${c}$`, "u").test(wd[2]));
      if (i >= 0) {
        // «来週の金曜日», «下周五» — пятница следующей недели, а не ближайшая
        if (wd[1]) return { date: addDays(today, 7 - mondayIndex(today) + i) };
        return { date: nextWeekday(today, i) };
      }
    }
    return null;
  };

  // час: «午後7時半», «下午3点15分», «19:30», «7時»
  const TIME = `(?:(?:${v.am}|${v.pm})\\s*)?\\d{1,2}(?:\\s*(?:${v.hour})(?!間|间)(?:\\s*\\d{1,2}\\s*分(?!钟|鐘|間|间)|\\s*半)?|:\\d{2})`;
  const ONE = rx(
    `^(?:(${v.am})|(${v.pm}))?\\s*(\\d{1,2})(?:\\s*(?:${v.hour})(?:\\s*(\\d{1,2})\\s*分|\\s*(半))?|:(\\d{2}))$`,
  );

  type Clock = { h: number; m: number; part?: "am" | "pm" };
  const readClock = (s: string): Clock | null => {
    const m = s.trim().match(ONE);
    if (!m) return null;
    const part = m[1] ? "am" : m[2] ? "pm" : undefined;
    return { h: Number(m[3]), m: m[5] ? 30 : Number(m[4] ?? m[6] ?? 0), part };
  };
  const to24 = (c: Clock, part: "am" | "pm" | undefined, evening: boolean): number => {
    if (part === "pm" || (!part && evening)) return c.h < 12 ? c.h + 12 : c.h;
    if (part === "am" && c.h === 12) return 0;
    return c.h;
  };

  const parseTime = (cut: Cut, evening: boolean): TimeRange | null => {
    if (cut.take(rx(v.noon))) return { h: 12, m: 0 };

    const range = cut.take(rx(`(${TIME})\\s*(?:${v.rangeSep})\\s*(${TIME})${v.rangeEnd ? `(?:\\s*(?:${v.rangeEnd}))?` : ""}`));
    if (range) {
      const a = readClock(range[1]);
      const b = readClock(range[2]);
      if (a && b) {
        // «午後7時から9時»: конец без части дня — та же часть, что у начала
        const h = to24(a, a.part ?? b.part, evening);
        const endH = to24(b, b.part ?? a.part, evening);
        if (validTime(h, a.m) && validTime(endH, b.m)) return { h, m: a.m, endH, endM: b.m };
      }
    }

    const one = cut.take(rx(TIME));
    if (one) {
      const c = readClock(one[0]);
      if (c) {
        const h = to24(c, c.part, evening);
        if (validTime(h, c.m)) return { h, m: c.m };
      }
    }
    return null;
  };

  const parseDuration = (cut: Cut): number | null => {
    if (cut.take(rx(v.halfHour))) return 30;
    const hh = cut.take(rx(v.hourAndHalf));
    if (hh) return Number(hh[1]) * 60 + 30;
    const d = cut.take(rx(`(\\d+(?:[.,]\\d+)?)\\s*(?:(${v.durMinute})|(${v.durHour}))`));
    if (!d) return null;
    const n = Number(d[1].replace(",", "."));
    return Math.round(d[3] ? n * 60 : n);
  };

  // На месте вырезанного куска cutter оставляет пробел, поэтому частицы у кусков названия видны по краям
  const alone = new RegExp(`^(?:${v.particles})+$`, "u");
  const edges = v.edgeParticles ? new RegExp(`^(?:${v.edgeParticles})+|(?:${v.edgeParticles})+$`, "gu") : null;
  const cleanTitle = (text: string) =>
    text
      .split(/\s+/)
      .filter((part) => !alone.test(part))
      .map((part) => (edges ? part.replace(edges, "") : part))
      .filter(Boolean)
      .join(" ");

  return (input: string, now: Date, calendars: QuickCalendar[]): QuickResult => {
    const cut = cutter(kanjiToDigits(input));
    const tags = takeTags(cut, calendars);
    const date = parseDate(cut, now);
    const time = parseTime(cut, date?.evening ?? false);
    const duration = parseDuration(cut);
    return assemble({ title: cleanTitle(cut.text), date: date?.date ?? null, time, duration, ...tags }, now);
  };
};
