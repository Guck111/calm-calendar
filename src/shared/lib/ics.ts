// Календарь в формате iCalendar (.ics, RFC 5545): разбор файла и раскладка повторов на нужные дни.
// Нужен подпискам по ссылке: их скачивает Rust, а события в календарь кладёт этот код.
// Поддержаны повторы, которые встречаются в настоящих файлах (Google, Outlook, расписания, спорт):
// FREQ DAILY/WEEKLY/MONTHLY/YEARLY с INTERVAL, COUNT, UNTIL, BYDAY (и «2-й вторник»), BYMONTHDAY, BYMONTH,
// а также EXDATE, RDATE и перенесённые повторения (RECURRENCE-ID). Правило с чем-то ещё (BYSETPOS…)
// показывает только первое событие серии — лучше одно верное, чем много неверных.
import type { CalendarEvent } from "../api/types";
import type { DateRange } from "./date";
import { findMeeting } from "./meeting";
import { fromZonedParts, isTimeZone } from "./tz";

/** время из файла как оно записано: дата, время по часам, UTC или пояс */
export type IcsTime = {
  y: number;
  mo: number;
  d: number;
  /** нет — дата без времени (событие на весь день) */
  time?: { h: number; mi: number; s: number };
  /** время с Z на конце */
  utc?: boolean;
  /** пояс IANA; нет и не utc — «плавающее» время, по часам компьютера */
  zone?: string;
};

export type IcsEvent = {
  uid: string;
  summary?: string;
  description?: string;
  location?: string;
  start: IcsTime;
  end?: IcsTime;
  /** DURATION в миллисекундах */
  durationMs?: number;
  rrule?: string;
  exdates: IcsTime[];
  rdates: IcsTime[];
  /** у перенесённого повторения — исходное время повторения */
  recurrenceId?: IcsTime;
  cancelled: boolean;
  /** TRANSP:TRANSPARENT — время не занято */
  free: boolean;
};

export type IcsCalendar = { name?: string; events: IcsEvent[] };

// --- строки файла ---

/** строки файла: перенос с пробелом или табом в начале продолжает предыдущую строку */
const unfold = (text: string): string[] =>
  text
    .replace(/\r\n?/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n")
    .filter((l) => l.trim() !== "");

type Line = { name: string; params: Record<string, string>; value: string };

/** «DTSTART;TZID="Europe/Berlin":20261111T090000» → имя, параметры, значение; двоеточие в кавычках не граница */
const parseLine = (raw: string): Line | null => {
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '"') quoted = !quoted;
    else if (raw[i] === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const head = raw.slice(0, colon);
  const parts: string[] = [];
  let cur = "";
  quoted = false;
  for (const ch of head) {
    if (ch === '"') quoted = !quoted;
    if (ch === ";" && !quoted) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  const [name, ...rest] = parts;
  const params: Record<string, string> = {};
  for (const p of rest) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: name.toUpperCase(), params, value: raw.slice(colon + 1) };
};

/** текст из файла: \n — перенос строки, \, \; \\ — сами знаки */
export const unescapeText = (v: string): string =>
  v.replace(/\\([nN,;\\])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));

// --- пояса ---

/** пояса Windows, которыми подписывает файлы Outlook, → IANA */
const WINDOWS_ZONES: Record<string, string> = {
  "UTC": "UTC",
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  "W. Europe Standard Time": "Europe/Berlin",
  "Central Europe Standard Time": "Europe/Budapest",
  "Central European Standard Time": "Europe/Warsaw",
  "Romance Standard Time": "Europe/Paris",
  "E. Europe Standard Time": "Europe/Chisinau",
  "FLE Standard Time": "Europe/Kiev",
  "GTB Standard Time": "Europe/Bucharest",
  "Russian Standard Time": "Europe/Moscow",
  "Belarus Standard Time": "Europe/Minsk",
  "Turkey Standard Time": "Europe/Istanbul",
  "Israel Standard Time": "Asia/Jerusalem",
  "Arabian Standard Time": "Asia/Dubai",
  "Arab Standard Time": "Asia/Riyadh",
  "Egypt Standard Time": "Africa/Cairo",
  "South Africa Standard Time": "Africa/Johannesburg",
  "India Standard Time": "Asia/Kolkata",
  "Bangladesh Standard Time": "Asia/Dhaka",
  "SE Asia Standard Time": "Asia/Bangkok",
  "China Standard Time": "Asia/Shanghai",
  "Singapore Standard Time": "Asia/Singapore",
  "Tokyo Standard Time": "Asia/Tokyo",
  "Korea Standard Time": "Asia/Seoul",
  "AUS Eastern Standard Time": "Australia/Sydney",
  "New Zealand Standard Time": "Pacific/Auckland",
  "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago",
  "Mountain Standard Time": "America/Denver",
  "US Mountain Standard Time": "America/Phoenix",
  "Pacific Standard Time": "America/Los_Angeles",
  "Alaskan Standard Time": "America/Anchorage",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  "Atlantic Standard Time": "America/Halifax",
  "E. South America Standard Time": "America/Sao_Paulo",
  "Argentina Standard Time": "America/Argentina/Buenos_Aires",
  "Central Standard Time (Mexico)": "America/Mexico_City",
};

/** TZID из файла → пояс IANA; «/Europe/Berlin» и «/mozilla.org/…/Europe/Berlin» тоже узнаём */
export const zoneOf = (tzid: string | undefined): string | undefined => {
  if (!tzid) return undefined;
  const name = tzid.trim();
  if (isTimeZone(name)) return name;
  if (WINDOWS_ZONES[name]) return WINDOWS_ZONES[name];
  const tail = /([A-Za-z]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)$/.exec(name)?.[1];
  return tail && isTimeZone(tail) ? tail : undefined;
};

// --- значения ---

/** «20261111», «20261111T090000», «20261111T090000Z» */
export const parseTime = (value: string, params: Record<string, string> = {}): IcsTime | null => {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  const base = { y: Number(y), mo: Number(mo), d: Number(d) };
  if (h === undefined || params.VALUE === "DATE") return base;
  const time = { h: Number(h), mi: Number(mi), s: Number(s ?? 0) };
  if (z) return { ...base, time, utc: true };
  const zone = zoneOf(params.TZID);
  return zone ? { ...base, time, zone } : { ...base, time };
};

/** «PT1H30M», «P1D», «P2W», «-PT15M» → миллисекунды */
export const parseDuration = (value: string): number | null => {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!m || value.trim() === "P" || value.trim().endsWith("T")) return null;
  const [, sign, w, d, h, mi, s] = m;
  const ms = ((((Number(w ?? 0) * 7 + Number(d ?? 0)) * 24 + Number(h ?? 0)) * 60 + Number(mi ?? 0)) * 60 + Number(s ?? 0)) * 1000;
  return sign === "-" ? -ms : ms;
};

/** момент времени: дата без времени — местная полночь, плавающее время — по часам компьютера */
export const toInstant = (t: IcsTime): Date => {
  if (!t.time) return new Date(t.y, t.mo - 1, t.d);
  if (t.utc) return new Date(Date.UTC(t.y, t.mo - 1, t.d, t.time.h, t.time.mi, t.time.s));
  if (t.zone) return fromZonedParts(t.y, t.mo, t.d, t.time.h, t.time.mi, t.time.s, t.zone);
  return new Date(t.y, t.mo - 1, t.d, t.time.h, t.time.mi, t.time.s);
};

const listTimes = (line: Line): IcsTime[] =>
  line.params.VALUE === "PERIOD"
    ? []
    : line.value.split(",").flatMap((v) => parseTime(v, line.params) ?? []);

// --- разбор файла ---

export const parseIcs = (text: string): IcsCalendar => {
  const events: IcsEvent[] = [];
  let name: string | undefined;
  let current: Partial<IcsEvent> | null = null;
  // вложенные блоки события (VALARM) пропускаем
  let nested = 0;
  for (const raw of unfold(text)) {
    const line = parseLine(raw);
    if (!line) continue;
    if (line.name === "BEGIN") {
      if (line.value.toUpperCase() === "VEVENT" && !current) current = { exdates: [], rdates: [], cancelled: false, free: false };
      else if (current) nested++;
      continue;
    }
    if (line.name === "END") {
      if (current && nested) nested--;
      else if (current && line.value.toUpperCase() === "VEVENT") {
        if (current.uid !== undefined && current.start) events.push(current as IcsEvent);
        current = null;
      }
      continue;
    }
    if (!current) {
      if (line.name === "X-WR-CALNAME" && line.value.trim()) name = unescapeText(line.value.trim());
      continue;
    }
    if (nested) continue;
    switch (line.name) {
      case "UID":
        current.uid = line.value.trim();
        break;
      case "SUMMARY":
        current.summary = unescapeText(line.value).trim();
        break;
      case "DESCRIPTION":
        current.description = unescapeText(line.value).trim();
        break;
      case "LOCATION":
        current.location = unescapeText(line.value).trim();
        break;
      case "DTSTART":
        current.start = parseTime(line.value, line.params) ?? undefined;
        break;
      case "DTEND":
        current.end = parseTime(line.value, line.params) ?? undefined;
        break;
      case "DURATION":
        current.durationMs = parseDuration(line.value) ?? undefined;
        break;
      case "RRULE":
        current.rrule = line.value.trim();
        break;
      case "EXDATE":
        current.exdates?.push(...listTimes(line));
        break;
      case "RDATE":
        current.rdates?.push(...listTimes(line));
        break;
      case "RECURRENCE-ID":
        current.recurrenceId = parseTime(line.value, line.params) ?? undefined;
        break;
      case "STATUS":
        current.cancelled = line.value.trim().toUpperCase() === "CANCELLED";
        break;
      case "TRANSP":
        current.free = line.value.trim().toUpperCase() === "TRANSPARENT";
        break;
    }
  }
  // событие без UID всё равно показываем: id придумываем из начала и названия
  for (const e of events) if (!e.uid) e.uid = `${e.summary ?? ""}@${e.start.y}${e.start.mo}${e.start.d}`;
  return { name, events };
};

// --- правило повтора ---

type Freq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export type IcsRule = {
  freq: Freq;
  interval: number;
  count?: number;
  until?: IcsTime;
  byDay: { n?: number; wd: number }[];
  byMonthDay: number[];
  byMonth: number[];
  /** день начала недели для INTERVAL у WEEKLY, 0 — воскресенье */
  wkst: number;
};

const numbers = (v: string | undefined, min: number, max: number): number[] | null => {
  if (!v) return [];
  const out = v.split(",").map(Number);
  return out.every((n) => Number.isInteger(n) && n !== 0 && Math.abs(n) >= min && Math.abs(n) <= max) ? out : null;
};

/** null — правило с тем, что мы не умеем раскладывать */
export const parseRule = (value: string): IcsRule | null => {
  const parts = new Map<string, string>();
  for (const p of value.replace(/^RRULE:/i, "").split(";")) {
    const [k, v] = p.split("=");
    if (k && v !== undefined) parts.set(k.toUpperCase(), v.toUpperCase());
  }
  const known = new Set(["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "BYMONTHDAY", "BYMONTH", "WKST"]);
  if ([...parts.keys()].some((k) => !known.has(k))) return null;
  const freq = parts.get("FREQ") as Freq;
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) return null;
  const interval = Number(parts.get("INTERVAL") ?? 1);
  if (!Number.isInteger(interval) || interval < 1) return null;
  const count = parts.has("COUNT") ? Number(parts.get("COUNT")) : undefined;
  if (count !== undefined && (!Number.isInteger(count) || count < 1)) return null;
  const until = parts.has("UNTIL") ? parseTime(parts.get("UNTIL") ?? "") : undefined;
  if (until === null) return null;
  const byDay: IcsRule["byDay"] = [];
  for (const tok of parts.get("BYDAY")?.split(",") ?? []) {
    const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(tok);
    if (!m) return null;
    const n = m[1] ? Number(m[1]) : undefined;
    if (n === 0) return null;
    byDay.push({ ...(n ? { n } : {}), wd: WEEKDAY_CODES.indexOf(m[2]) });
  }
  const byMonthDay = numbers(parts.get("BYMONTHDAY"), 1, 31);
  const byMonth = numbers(parts.get("BYMONTH"), 1, 12);
  if (!byMonthDay || !byMonth || byMonth.some((n) => n < 0)) return null;
  const wkst = parts.has("WKST") ? WEEKDAY_CODES.indexOf(parts.get("WKST") ?? "") : 1;
  if (wkst < 0) return null;
  return { freq, interval, ...(count ? { count } : {}), ...(until ? { until } : {}), byDay, byMonthDay, byMonth, wkst };
};

// дни календаря считаем в UTC: так переход на летнее время не сдвигает даты
const DAY_MS = 86_400_000;
const dayNumber = (y: number, mo: number, d: number) => Math.round(Date.UTC(y, mo - 1, d) / DAY_MS);
const fromDayNumber = (n: number) => {
  const dt = new Date(n * DAY_MS);
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate(), wd: dt.getUTCDay() };
};
const daysInMonth = (y: number, mo: number) => new Date(Date.UTC(y, mo, 0)).getUTCDate();
const daysInYear = (y: number) => dayNumber(y + 1, 1, 1) - dayNumber(y, 1, 1);

/** день (номер дня) подходит под правило; start — номер дня начала серии */
const matches = (rule: IcsRule, start: number, day: number): boolean => {
  const s = fromDayNumber(start);
  const c = fromDayNumber(day);
  switch (rule.freq) {
    case "DAILY":
      if ((day - start) % rule.interval !== 0) return false;
      break;
    case "WEEKLY": {
      const weekStart = (n: number) => n - ((fromDayNumber(n).wd - rule.wkst + 7) % 7);
      if (Math.round((weekStart(day) - weekStart(start)) / 7) % rule.interval !== 0) return false;
      break;
    }
    case "MONTHLY":
      if (((c.y - s.y) * 12 + c.mo - s.mo) % rule.interval !== 0) return false;
      break;
    case "YEARLY":
      if ((c.y - s.y) % rule.interval !== 0) return false;
      break;
  }
  const hasDay = rule.byDay.length > 0;
  const hasMonthDay = rule.byMonthDay.length > 0;
  // месяц
  if (rule.byMonth.length) {
    if (!rule.byMonth.includes(c.mo)) return false;
  } else if (rule.freq === "YEARLY" && !(hasDay && !hasMonthDay)) {
    if (c.mo !== s.mo) return false;
  }
  // число месяца
  if (hasMonthDay) {
    const dim = daysInMonth(c.y, c.mo);
    if (!rule.byMonthDay.some((n) => (n > 0 ? n : dim + n + 1) === c.d)) return false;
  } else if ((rule.freq === "MONTHLY" || rule.freq === "YEARLY") && !hasDay) {
    if (c.d !== s.d) return false;
  }
  // день недели, с номером — внутри месяца (или года у YEARLY без BYMONTH)
  if (hasDay) {
    const inYear = rule.freq === "YEARLY" && !rule.byMonth.length;
    const ok = rule.byDay.some(({ n, wd }) => {
      if (wd !== c.wd) return false;
      if (!n || rule.freq === "DAILY" || rule.freq === "WEEKLY") return true;
      const index = inYear ? day - dayNumber(c.y, 1, 1) : c.d - 1;
      const total = inYear ? daysInYear(c.y) : daysInMonth(c.y, c.mo);
      return n > 0 ? Math.floor(index / 7) + 1 === n : Math.floor((total - 1 - index) / 7) + 1 === -n;
    });
    if (!ok) return false;
  } else if (rule.freq === "WEEKLY" && c.wd !== s.wd) {
    return false;
  }
  return true;
};

/** сколько повторений самое большее раскладываем у одного события */
const MAX_OCCURRENCES = 5000;

const sameMoment = (a: IcsTime, b: IcsTime): boolean =>
  a.time && b.time ? toInstant(a).getTime() === toInstant(b).getTime() : a.y === b.y && a.mo === b.mo && a.d === b.d;

/** UNTIL по часам события: время без Z — в поясе события, дата без времени у события со временем — до конца дня */
const untilTime = (until: IcsTime, first: IcsTime): IcsTime => {
  if (until.time) return until.utc ? until : { ...until, zone: first.zone, utc: first.utc };
  return first.time ? { ...until, time: { h: 23, mi: 59, s: 59 }, zone: first.zone, utc: first.utc } : until;
};

/** Начала повторений события, которые могут задеть промежуток (с запасом на длительность) */
export const occurrenceStarts = (e: IcsEvent, range: DateRange, durationMs: number): IcsTime[] => {
  const first = e.start;
  const rule = e.rrule ? parseRule(e.rrule) : null;
  const out: IcsTime[] = [first];
  if (rule) {
    const start = dayNumber(first.y, first.mo, first.d);
    const lastDay = Math.floor(range.end.getTime() / DAY_MS) + 2;
    // без COUNT можно не считать повторения до промежутка: начинаем рядом с ним
    const earliest = Math.floor((range.start.getTime() - Math.max(durationMs, 0)) / DAY_MS) - 2;
    const from = rule.count ? start + 1 : Math.max(start + 1, earliest);
    const until = rule.until ? toInstant(untilTime(rule.until, first)) : null;
    let produced = 1;
    for (let day = from; day <= lastDay && produced < MAX_OCCURRENCES; day++) {
      if (rule.count && produced >= rule.count) break;
      if (!matches(rule, start, day)) continue;
      const { y, mo, d } = fromDayNumber(day);
      const t: IcsTime = { ...first, y, mo, d };
      if (until && toInstant(t) > until) break;
      produced++;
      out.push(t);
    }
  }
  for (const r of e.rdates) if (!out.some((o) => sameMoment(o, r))) out.push(r);
  return out.filter((t) => !e.exdates.some((x) => sameMoment(x, t)));
};

/** длительность: DTEND, DURATION или по умолчанию (день у событий на весь день, ноль у остальных) */
const durationOf = (e: IcsEvent): { ms: number; days?: number } => {
  if (!e.start.time) {
    if (e.end && !e.end.time) return { ms: 0, days: Math.max(1, dayNumber(e.end.y, e.end.mo, e.end.d) - dayNumber(e.start.y, e.start.mo, e.start.d)) };
    if (e.durationMs) return { ms: 0, days: Math.max(1, Math.round(e.durationMs / DAY_MS)) };
    return { ms: 0, days: 1 };
  }
  if (e.end) return { ms: Math.max(0, toInstant(e.end).getTime() - toInstant(e.start).getTime()) };
  return { ms: Math.max(0, e.durationMs ?? 0) };
};

const instanceKey = (t: IcsTime): string => (t.time ? String(toInstant(t).getTime()) : `${t.y}-${t.mo}-${t.d}`);

/** Событие календаря приложения: только для чтения, без связи с Google */
const toEvent = (calendarId: string, account: string, e: IcsEvent, start: IcsTime, untitled: string): CalendarEvent => {
  const dur = durationOf(e);
  const begin = toInstant(start);
  const end = dur.days ? new Date(start.y, start.mo - 1, start.d + dur.days) : new Date(begin.getTime() + dur.ms);
  const id = `${e.uid}_${instanceKey(start)}`;
  const meeting = findMeeting({ location: e.location, description: e.description });
  return {
    key: `${calendarId}\u0000${id}`,
    id,
    calendarId,
    account,
    free: e.free,
    title: e.summary || untitled,
    start: begin,
    end,
    allDay: !start.time,
    ...(start.time && start.zone ? { timeZone: start.zone } : {}),
    ...(e.location ? { location: e.location } : {}),
    ...(e.description ? { description: e.description } : {}),
    ...(meeting ? { meeting } : {}),
    // «повторяется» в карточке читает правило из Google — у подписки его там нет
    recurring: false,
    reminders: "default",
    organizerSelf: false,
  };
};

/** События календаря из файла, которые задевают промежуток: повторы разложены, перенесённые и отменённые учтены */
export const expandIcs = (
  cal: IcsCalendar,
  range: DateRange,
  calendarId: string,
  account: string,
  untitled: string,
): CalendarEvent[] => {
  // перенесённые повторения по UID и исходному времени
  const moved = new Map<string, IcsEvent>();
  for (const e of cal.events) if (e.recurrenceId) moved.set(`${e.uid}\u0000${instanceKey(e.recurrenceId)}`, e);
  const out: CalendarEvent[] = [];
  const add = (e: IcsEvent, start: IcsTime) => {
    const event = toEvent(calendarId, account, e, start, untitled);
    if (event.start < range.end && (event.end > range.start || event.start >= range.start)) out.push(event);
  };
  for (const e of cal.events) {
    if (e.recurrenceId) {
      if (!e.cancelled) add(e, e.start);
      continue;
    }
    if (e.cancelled) continue;
    for (const start of occurrenceStarts(e, range, durationOf(e).ms + (durationOf(e).days ?? 0) * DAY_MS)) {
      if (moved.has(`${e.uid}\u0000${instanceKey(start)}`)) continue;
      add(e, start);
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
};
