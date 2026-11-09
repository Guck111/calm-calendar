// Правило повтора события (RRULE из RFC 5545) в том объёме, который умеет форма:
// каждый день, неделю, месяц или год с шагом, дни недели, «2-й вторник месяца»,
// конец по дате или по числу повторов. Правило сложнее остаётся как есть и не правится.
import { locale, t, weekStart } from "../i18n";
import { addDays, daysBetween, fromDateKey, startOfDay, startOfWeek, toDateKey } from "./date";

export type Freq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export const FREQS: Freq[] = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];

/** коды дней недели по порядку Date.getDay(): 0 — воскресенье */
export const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type RuleEnd = { kind: "never" } | { kind: "until"; date: string } | { kind: "count"; count: number };

export type Rule = {
  freq: Freq;
  interval: number;
  /** WEEKLY: дни недели (без BYDAY в правиле — день начала) */
  days: Weekday[];
  /** MONTHLY: n-й день недели месяца, 1…4 или −1 — последний; без него — то же число, что у начала */
  nth?: number;
  end: RuleEnd;
};

/** Разобранный список recurrence из Google: правило (null — не умеем править) и прочие строки (EXDATE, RDATE) */
export type Recurrence = { rule: Rule | null; extra: string[] };

const BUSINESS: Weekday[] = ["MO", "TU", "WE", "TH", "FR"];

export const weekdayOf = (d: Date): Weekday => WEEKDAYS[d.getDay()];

const daysInMonth = (d: Date): number => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

/** какой по счёту этот день недели в месяце: 1…5 */
export const nthOf = (d: Date): number => Math.ceil(d.getDate() / 7);
export const isLastWeekday = (d: Date): boolean => d.getDate() + 7 > daysInMonth(d);

/** n-й день недели для правила «каждый месяц»: пятый бывает не всегда, поэтому он «последний» */
export const monthlyNth = (d: Date): number => (nthOf(d) > 4 ? -1 : nthOf(d));

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** UNTIL из правила → последний день повторений по местному времени, включительно.
 *  Для событий со временем UNTIL точный: 8:59:59 при начале в 9:00 значит «до вчера» */
export const parseUntil = (value: string, start: Date): string | null => {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined) return `${y}-${mo}-${d}`;
  const until = z
    ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s))
    : new Date(+y, +mo - 1, +d, +h, +mi, +s);
  const sameDay = new Date(until.getFullYear(), until.getMonth(), until.getDate(), start.getHours(), start.getMinutes());
  return toDateKey(sameDay > until ? addDays(sameDay, -1) : sameDay);
};

/** UTC в виде 20261104T090000Z */
export const utcStamp = (d: Date): string =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

const dateStamp = (key: string): string => key.replaceAll("-", "");

/** UNTIL для правила: для событий на весь день — дата, для событий со временем — конец дня в UTC */
export const formatUntil = (dateKey: string, allDay: boolean): string => {
  if (allDay) return dateStamp(dateKey);
  const day = fromDateKey(dateKey);
  return utcStamp(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59));
};

const isRRule = (line: string) => /^RRULE:/i.test(line);

const parseRule = (line: string, start: Date): Rule | null => {
  const parts = new Map<string, string>();
  for (const part of line.slice(6).split(";")) {
    const [k, v] = part.split("=");
    if (!k || v === undefined || parts.has(k.toUpperCase())) return null;
    parts.set(k.toUpperCase(), v.toUpperCase());
  }
  const allowed = new Set(["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "BYMONTH", "COUNT", "UNTIL", "WKST"]);
  if ([...parts.keys()].some((k) => !allowed.has(k))) return null;

  const freq = parts.get("FREQ") as Freq;
  if (!FREQS.includes(freq)) return null;
  const interval = parts.has("INTERVAL") ? Number(parts.get("INTERVAL")) : 1;
  if (!Number.isInteger(interval) || interval < 1) return null;

  let end: RuleEnd = { kind: "never" };
  const count = parts.get("COUNT");
  const until = parts.get("UNTIL");
  if (count && until) return null;
  if (count) {
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1) return null;
    end = { kind: "count", count: n };
  }
  if (until) {
    const date = parseUntil(until, start);
    if (!date) return null;
    end = { kind: "until", date };
  }

  // числа и месяцы допускаем только совпадающие с началом: тогда они ничего не меняют
  const monthDay = parts.get("BYMONTHDAY");
  if (monthDay && (!["MONTHLY", "YEARLY"].includes(freq) || Number(monthDay) !== start.getDate())) return null;
  const month = parts.get("BYMONTH");
  if (month && (freq !== "YEARLY" || Number(month) !== start.getMonth() + 1)) return null;

  const tokens = parts.get("BYDAY")?.split(",") ?? [];
  const byDay = tokens.map((tok) => /^([+-]?\d)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(tok));
  if (byDay.some((m) => !m)) return null;

  const rule: Rule = { freq, interval, days: [], end };
  if (freq === "WEEKLY") {
    if (byDay.some((m) => m?.[1])) return null;
    const days = new Set(byDay.map((m) => m?.[2] as Weekday));
    rule.days = days.size ? WEEKDAYS.filter((d) => days.has(d)) : [weekdayOf(start)];
    return rule;
  }
  if (freq === "MONTHLY" && byDay.length) {
    const [m] = byDay;
    const nth = Number(m?.[1]);
    if (byDay.length !== 1 || monthDay || m?.[2] !== weekdayOf(start)) return null;
    if (!(nth === -1 ? isLastWeekday(start) : nth >= 1 && nth <= 4 && nthOf(start) === nth)) return null;
    rule.nth = nth;
    return rule;
  }
  return byDay.length ? null : rule;
};

export const parseRecurrence = (lines: string[], start: Date): Recurrence => {
  const rules = lines.filter(isRRule);
  const extra = lines.filter((l) => !isRRule(l));
  // EXRULE устарел, но если встретился — правило не наше
  if (rules.length !== 1 || extra.some((l) => /^EXRULE:/i.test(l))) return { rule: null, extra };
  return { rule: parseRule(rules[0], start), extra };
};

const dayOrder = (d: Weekday) => (WEEKDAYS.indexOf(d) + 6) % 7;

export const formatRule = (rule: Rule, start: Date, allDay: boolean): string => {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.freq === "WEEKLY") {
    const days = rule.days.length ? rule.days : [weekdayOf(start)];
    parts.push(`BYDAY=${[...days].sort((a, b) => dayOrder(a) - dayOrder(b)).join(",")}`);
  }
  if (rule.freq === "MONTHLY" && rule.nth) parts.push(`BYDAY=${rule.nth}${weekdayOf(start)}`);
  if (rule.end.kind === "count") parts.push(`COUNT=${rule.end.count}`);
  if (rule.end.kind === "until") parts.push(`UNTIL=${formatUntil(rule.end.date, allDay)}`);
  return `RRULE:${parts.join(";")}`;
};

export const buildRecurrence = (rule: Rule | null, extra: string[], start: Date, allDay: boolean): string[] =>
  rule ? [formatRule(rule, start, allDay), ...extra] : [];

/** Готовые варианты повтора для начала события */
export type PresetId = "daily" | "weekdays" | "weekly" | "monthly" | "monthlyNth" | "yearly";
export const PRESETS: PresetId[] = ["daily", "weekdays", "weekly", "monthly", "monthlyNth", "yearly"];

export const presetRule = (id: PresetId, start: Date): Rule => {
  const never: RuleEnd = { kind: "never" };
  switch (id) {
    case "daily":
      return { freq: "DAILY", interval: 1, days: [], end: never };
    case "weekdays":
      return { freq: "WEEKLY", interval: 1, days: [...BUSINESS], end: never };
    case "weekly":
      return { freq: "WEEKLY", interval: 1, days: [weekdayOf(start)], end: never };
    case "monthly":
      return { freq: "MONTHLY", interval: 1, days: [], end: never };
    case "monthlyNth":
      return { freq: "MONTHLY", interval: 1, days: [], nth: monthlyNth(start), end: never };
    case "yearly":
      return { freq: "YEARLY", interval: 1, days: [], end: never };
  }
};

const sameRule = (a: Rule, b: Rule): boolean =>
  a.freq === b.freq &&
  a.interval === b.interval &&
  (a.nth ?? 0) === (b.nth ?? 0) &&
  a.days.join() === b.days.join() &&
  JSON.stringify(a.end) === JSON.stringify(b.end);

/** какой готовый вариант совпадает с правилом; null — правило своё */
export const presetOf = (rule: Rule, start: Date): PresetId | null =>
  PRESETS.find((id) => sameRule(presetRule(id, start), rule)) ?? null;

/** Начало события сдвинули: «каждую среду» становится «каждым четвергом», «2-й вторник» — новым днём */
export const followStart = (rule: Rule, from: Date, to: Date): Rule => {
  if (rule.freq === "WEEKLY" && rule.days.length === 1 && rule.days[0] === weekdayOf(from)) {
    return { ...rule, days: [weekdayOf(to)] };
  }
  if (rule.freq === "MONTHLY" && rule.nth) {
    return { ...rule, nth: rule.nth === -1 && isLastWeekday(to) ? -1 : monthlyNth(to) };
  }
  return rule;
};

/** Правило с концом прямо перед повторением split: так серия обрезается при «это и следующие» */
export const truncateBefore = (lines: string[], split: Date, allDay: boolean): string[] =>
  lines.map((line) => {
    if (!isRRule(line)) return line;
    const kept = line
      .slice(6)
      .split(";")
      .filter((p) => !/^(COUNT|UNTIL)=/i.test(p));
    const until = allDay ? dateStamp(toDateKey(addDays(startOfDay(split), -1))) : utcStamp(new Date(split.getTime() - 1000));
    return `RRULE:${[...kept, `UNTIL=${until}`].join(";")}`;
  });

const monthsBetween = (a: Date, b: Date) => (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();

/** Попадает ли день в правило (без учёта конца). Неделя для шага считается с понедельника, как в Google */
const matches = (rule: Rule, start: Date, day: Date): boolean => {
  const sameMonthDay = day.getDate() === start.getDate();
  switch (rule.freq) {
    case "DAILY":
      return daysBetween(start, day) % rule.interval === 0;
    case "WEEKLY": {
      const monday = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));
      const weeks = Math.round(daysBetween(monday(start), monday(day)) / 7);
      return weeks % rule.interval === 0 && rule.days.includes(weekdayOf(day));
    }
    case "MONTHLY": {
      if (monthsBetween(start, day) % rule.interval !== 0) return false;
      if (!rule.nth) return sameMonthDay;
      if (weekdayOf(day) !== weekdayOf(start)) return false;
      return rule.nth === -1 ? isLastWeekday(day) : nthOf(day) === rule.nth;
    }
    case "YEARLY":
      return (
        (day.getFullYear() - start.getFullYear()) % rule.interval === 0 &&
        day.getMonth() === start.getMonth() &&
        sameMonthDay
      );
  }
};

/** Начала повторений до before (не включительно). Нужно примерным данным и тестам */
export const occurrences = (rule: Rule, start: Date, before: Date, limit = 1000): Date[] => {
  const out: Date[] = [];
  const last = rule.end.kind === "until" ? addDays(fromDateKey(rule.end.date), 1) : before;
  const max = rule.end.kind === "count" ? rule.end.count : limit;
  for (let day = startOfDay(start); day < before && day < last && out.length < max; day = addDays(day, 1)) {
    if (day.getTime() !== startOfDay(start).getTime() && !matches(rule, start, day)) continue;
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), start.getHours(), start.getMinutes());
    if (at < before) out.push(at);
  }
  return out;
};

// подписи на языке интерфейса

const weekdayName = (d: Weekday, style: "short" | "long"): string => {
  const ref = startOfWeek(new Date(2026, 0, 7));
  const day = addDays(ref, (WEEKDAYS.indexOf(d) - ref.getDay() + 7) % 7);
  return new Intl.DateTimeFormat(locale, { weekday: style }).format(day);
};

/** дни недели по порядку недели региона */
export const orderedWeekdays = (): Weekday[] =>
  Array.from({ length: 7 }, (_, i) => WEEKDAYS[(weekStart() + i) % 7]);

export const weekdayLabel = (d: Weekday): string => weekdayName(d, "short");
export const weekdayLongName = (d: Weekday): string => weekdayName(d, "long");

const formatDate = (key: string, withYear: boolean): string =>
  new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", ...(withYear ? { year: "numeric" } : {}) })
    .format(fromDateKey(key))
    .replace(/\s*г\.$/, "");

/** «Раз в 2 недели, по пн и ср, до 31 декабря 2026» */
export const describeRule = (rule: Rule | null, start: Date): string => {
  const r = t.repeat;
  if (!rule) return r.special;
  const parts: string[] = [];
  const businessDays = rule.freq === "WEEKLY" && rule.interval === 1 && rule.days.join() === BUSINESS.join();
  if (businessDays) parts.push(r.weekdays);
  else {
    parts.push(r.every(rule.freq, rule.interval));
    if (rule.freq === "WEEKLY") {
      const order = orderedWeekdays();
      const days = [...rule.days].sort((a, b) => order.indexOf(a) - order.indexOf(b));
      const list = new Intl.ListFormat(locale, { type: "conjunction", style: "short" });
      parts.push(r.onDays(list.format(days.map((d) => weekdayName(d, "short")))));
    }
    if (rule.freq === "MONTHLY") {
      parts.push(
        rule.nth
          ? r.onNth(rule.nth, start.getDay(), weekdayName(weekdayOf(start), "long"))
          : r.onMonthDay(start.getDate()),
      );
    }
    if (rule.freq === "YEARLY") parts.push(r.onDate(formatDate(toDateKey(start), false)));
  }
  if (rule.end.kind === "until") parts.push(r.untilDate(formatDate(rule.end.date, true)));
  if (rule.end.kind === "count") parts.push(r.times(rule.end.count));
  return parts.join(r.sep);
};
