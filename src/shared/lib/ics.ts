// Calendar in iCalendar format (.ics, RFC 5545): parsing the file and expanding recurrences onto the needed days.
// Needed for link subscriptions: Rust downloads them, and this code puts the events into the calendar.
// Supported recurrences are those found in real files (Google, Outlook, timetables, sports):
// FREQ DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, COUNT, UNTIL, BYDAY (and "2nd Tuesday"), BYMONTHDAY, BYMONTH,
// plus EXDATE, RDATE and moved occurrences (RECURRENCE-ID). A rule with anything else (BYSETPOS…)
// shows only the first event of the series — better one correct than many wrong.
import type { CalendarEvent } from "../api/types";
import { WallClockDate, type DateRange } from "./date";
import { findMeeting } from "./meeting";
import { fromZonedParts, isTimeZone, wallClock } from "./tz";

type CustomZone = {
  offsetAt: (instant: number) => number;
  fromWall: (wall: number) => number;
};

type Duration = { days: number; ms: number };
type Period = { start: IcsTime; duration: Duration };

/** time from the file as written: date, wall clock time, UTC or time zone */
export type IcsTime = {
  y: number;
  mo: number;
  d: number;
  /** none — a date without time (all-day event) */
  time?: { h: number; mi: number; s: number };
  /** time with a trailing Z */
  utc?: boolean;
  /** IANA time zone; none and not utc — "floating" time, by the computer clock */
  zone?: string;
  customZone?: CustomZone;
};

export type IcsEvent = {
  uid: string;
  summary?: string;
  description?: string;
  location?: string;
  start: IcsTime;
  end?: IcsTime;
  /** DURATION in nominal milliseconds. */
  durationMs?: number;
  /** Days from DURATION that are added by the calendar. */
  durationDays?: number;
  rrule?: string;
  exdates: IcsTime[];
  rdates: IcsTime[];
  periods?: Period[];
  /** for a moved occurrence — the original time of the occurrence */
  recurrenceId?: IcsTime;
  rangeFuture?: boolean;
  cancelled: boolean;
  /** TRANSP:TRANSPARENT — time is not busy */
  free: boolean;
};

export type IcsCalendar = { name?: string; events: IcsEvent[] };

// --- file lines ---

/** file lines: a line break followed by a space or tab continues the previous line */
const unfold = (text: string): string[] =>
  text
    .replace(/\r\n?/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n")
    .filter((l) => l.trim() !== "");

type Line = { name: string; params: Record<string, string>; value: string };

/** «DTSTART;TZID="Europe/Berlin":20261111T090000» → name, parameters, value; a colon in quotes is not a boundary */
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

/** text from the file: \n — line break, \, \; \\ — the characters themselves */
export const unescapeText = (v: string): string =>
  v.replace(/\\([nN,;\\])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));

// --- time zones ---

/** Windows time zones that Outlook signs files with → IANA */
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

/** TZID from the file → IANA time zone; «/Europe/Berlin» and «/mozilla.org/…/Europe/Berlin» are recognized too */
export const zoneOf = (tzid: string | undefined): string | undefined => {
  if (!tzid) return undefined;
  const name = tzid.trim();
  if (isTimeZone(name)) return name;
  if (WINDOWS_ZONES[name]) return WINDOWS_ZONES[name];
  const tail = /([A-Za-z]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)$/.exec(name)?.[1];
  return tail && isTimeZone(tail) ? tail : undefined;
};

// --- values ---

/** «20261111», «20261111T090000», «20261111T090000Z» */
export const parseTime = (
  value: string,
  params: Record<string, string> = {},
  zones?: ReadonlyMap<string, CustomZone>,
): IcsTime | null => {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  const base = { y: Number(y), mo: Number(mo), d: Number(d) };
  // «20260230» is not a date: Date would quietly turn it into March 2
  if (base.mo < 1 || base.mo > 12 || base.d < 1 || base.d > new Date(Date.UTC(base.y, base.mo, 0)).getUTCDate()) return null;
  if (h === undefined || params.VALUE === "DATE") return base;
  const time = { h: Number(h), mi: Number(mi), s: Number(s ?? 0) };
  // a leap second (60) is allowed by RFC 5545
  if (time.h > 23 || time.mi > 59 || time.s > 60) return null;
  if (z) return { ...base, time, utc: true };
  const zone = zoneOf(params.TZID);
  if (zone) return { ...base, time, zone };
  const customZone = zones?.get(params.TZID?.trim());
  return customZone ? { ...base, time, customZone } : { ...base, time };
};

const durationParts = (value: string): Duration | null => {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!m || value.trim() === "P" || value.trim().endsWith("T")) return null;
  const [, sign, w, d, h, mi, s] = m;
  const days = Number(w ?? 0) * 7 + Number(d ?? 0);
  const ms = ((Number(h ?? 0) * 60 + Number(mi ?? 0)) * 60 + Number(s ?? 0)) * 1000;
  return sign === "-" ? { days: -days, ms: -ms } : { days, ms };
};

const durationSize = (duration: Duration): number => duration.days * DAY_MS + duration.ms;

/** Nominal number of milliseconds, not tied to a date or time zone. */
export const parseDuration = (value: string): number | null => {
  const duration = durationParts(value);
  return duration ? durationSize(duration) : null;
};

const wallStamp = (t: IcsTime): number =>
  Date.UTC(t.y, t.mo - 1, t.d, t.time?.h ?? 0, t.time?.mi ?? 0, t.time?.s ?? 0);

/** instant: a date without time is local midnight, floating time uses the computer clock */
export const toInstant = (t: IcsTime): Date => {
  if (!t.time) return new Date(t.y, t.mo - 1, t.d);
  if (t.utc) return new Date(wallStamp(t));
  if (t.zone) return fromZonedParts(t.y, t.mo, t.d, t.time.h, t.time.mi, t.time.s, t.zone);
  if (t.customZone) return new Date(t.customZone.fromWall(wallStamp(t)));
  return new Date(t.y, t.mo - 1, t.d, t.time.h, t.time.mi, t.time.s);
};

const listTimes = (line: Line, zones?: ReadonlyMap<string, CustomZone>): IcsTime[] =>
  line.params.VALUE === "PERIOD"
    ? []
    : line.value.split(",").flatMap((v) => parseTime(v, line.params, zones) ?? []);

const listPeriods = (line: Line, zones: ReadonlyMap<string, CustomZone>): Period[] =>
  line.value.split(",").flatMap((value) => {
    const [from, to, ...rest] = value.split("/");
    if (!to || rest.length) return [];
    const start = parseTime(from, line.params, zones);
    if (!start?.time) return [];
    const end = parseTime(to, line.params, zones);
    const duration = end?.time
      ? { days: 0, ms: toInstant(end).getTime() - toInstant(start).getTime() }
      : durationParts(to);
    return duration && durationSize(duration) > 0 ? [{ start, duration }] : [];
  });

// --- file parsing ---

export const parseIcs = (text: string): IcsCalendar => {
  const events: IcsEvent[] = [];
  const lines = unfold(text).flatMap((raw) => parseLine(raw) ?? []);
  const zones = readZones(lines);
  let name: string | undefined;
  let current: Partial<IcsEvent> | null = null;
  // nested event blocks (VALARM) are skipped
  let nested = 0;
  for (const line of lines) {
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
        current.start = parseTime(line.value, line.params, zones) ?? undefined;
        break;
      case "DTEND":
        current.end = parseTime(line.value, line.params, zones) ?? undefined;
        break;
      case "DURATION": {
        const duration = durationParts(line.value);
        current.durationMs = duration ? durationSize(duration) : undefined;
        current.durationDays = duration?.days || undefined;
        break;
      }
      case "RRULE":
        current.rrule = line.value.trim();
        break;
      case "EXDATE":
        current.exdates?.push(...listTimes(line, zones));
        break;
      case "RDATE":
        if (line.params.VALUE === "PERIOD") (current.periods ??= []).push(...listPeriods(line, zones));
        else current.rdates?.push(...listTimes(line, zones));
        break;
      case "RECURRENCE-ID":
        current.recurrenceId = parseTime(line.value, line.params, zones) ?? undefined;
        if (line.params.RANGE?.toUpperCase() === "THISANDFUTURE") current.rangeFuture = true;
        break;
      case "STATUS":
        current.cancelled = line.value.trim().toUpperCase() === "CANCELLED";
        break;
      case "TRANSP":
        current.free = line.value.trim().toUpperCase() === "TRANSPARENT";
        break;
    }
  }
  // an event without UID is still shown: the id is made up from the start and title
  for (const e of events) if (!e.uid) e.uid = `${e.summary ?? ""}@${e.start.y}${e.start.mo}${e.start.d}`;
  return { name, events };
};

// --- recurrence rule ---

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
  /** week start day for INTERVAL with WEEKLY, 0 — Sunday */
  wkst: number;
};

const numbers = (v: string | undefined, min: number, max: number): number[] | null => {
  if (!v) return [];
  const out = v.split(",").map(Number);
  return out.every((n) => Number.isInteger(n) && n !== 0 && Math.abs(n) >= min && Math.abs(n) <= max) ? out : null;
};

/** null — a rule with something we can't expand */
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

// calendar days are counted in UTC: that way the switch to summer time doesn't shift dates
const DAY_MS = 86_400_000;
const dayNumber = (y: number, mo: number, d: number) => Math.round(Date.UTC(y, mo - 1, d) / DAY_MS);
const fromDayNumber = (n: number) => {
  const dt = new Date(n * DAY_MS);
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate(), wd: dt.getUTCDay() };
};
const daysInMonth = (y: number, mo: number) => new Date(Date.UTC(y, mo, 0)).getUTCDate();
const daysInYear = (y: number) => dayNumber(y + 1, 1, 1) - dayNumber(y, 1, 1);

/** the day (day number) matches the rule; start — day number of the series start */
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
  // month
  if (rule.byMonth.length) {
    if (!rule.byMonth.includes(c.mo)) return false;
  } else if (rule.freq === "YEARLY" && !hasDay && !hasMonthDay) {
    if (c.mo !== s.mo) return false;
  }
  // day of month
  if (hasMonthDay) {
    const dim = daysInMonth(c.y, c.mo);
    if (!rule.byMonthDay.some((n) => (n > 0 ? n : dim + n + 1) === c.d)) return false;
  } else if ((rule.freq === "MONTHLY" || rule.freq === "YEARLY") && !hasDay) {
    if (c.d !== s.d) return false;
  }
  // weekday, with a number — within the month (or the year for YEARLY without BYMONTH)
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

/** the maximum number of occurrences we expand for one event */
const MAX_OCCURRENCES = 5000;

const sameMoment = (a: IcsTime, b: IcsTime): boolean =>
  a.time && b.time ? toInstant(a).getTime() === toInstant(b).getTime() : a.y === b.y && a.mo === b.mo && a.d === b.d;

/** UNTIL by the event clock: time without Z is in the event time zone, a date without time for a timed event — until the end of the day */
const untilTime = (until: IcsTime, first: IcsTime): IcsTime => {
  const clock = { zone: first.zone, utc: first.utc, customZone: first.customZone };
  if (until.time) return until.utc ? until : { ...until, ...clock };
  return first.time ? { ...until, time: { h: 23, mi: 59, s: 59 }, ...clock } : until;
};

const timeAt = (basis: IcsTime, date: Date): IcsTime => {
  const clock = basis.utc ? new WallClockDate(date.getTime())
    : basis.zone ? wallClock(date, basis.zone)
    : basis.customZone ? new WallClockDate(date.getTime() + basis.customZone.offsetAt(date.getTime()))
    : date;
  return {
    ...basis,
    y: clock.getFullYear(), mo: clock.getMonth() + 1, d: clock.getDate(),
    time: { h: clock.getHours(), mi: clock.getMinutes(), s: clock.getSeconds() },
  };
};

const onDay = (time: IcsTime, day: number): IcsTime => {
  const { y, mo, d } = fromDayNumber(day);
  return { ...time, y, mo, d };
};

function* ruleStarts(first: IcsTime, rule: IcsRule, earliest: number, lastDay: number): Iterable<IcsTime> {
  const start = dayNumber(first.y, first.mo, first.d);
  const from = rule.count ? start + 1 : Math.max(start + 1, earliest);
  const until = rule.until ? toInstant(untilTime(rule.until, first)) : null;
  let produced = 1;
  for (let day = from; day <= lastDay && produced < (rule.count ?? Infinity); day++) {
    if (!matches(rule, start, day)) continue;
    const time = onDay(first, day);
    if ((time.time && !time.utc) || until) {
      const at = toInstant(time);
      if (time.time && !time.utc && wallStamp(timeAt(time, at)) !== wallStamp(time)) continue;
      if (until && at > until) break;
    }
    produced++;
    if (day >= earliest) yield time;
  }
}

// --- custom VTIMEZONE time zones ---

type Observance = { start: IcsTime; from: number; to: number; rule?: IcsRule; rdates: IcsTime[] };
type Transition = { instant: number; from: number; to: number };

const parseOffset = (value: string): number | undefined => {
  const parts = /^([+-])(\d{2})(\d{2})(\d{2})?$/.exec(value.trim());
  if (!parts) return undefined;
  const [, sign, h, m, s = "0"] = parts;
  if (+h > 23 || +m > 59 || +s > 59) return undefined;
  return (sign === "-" ? -1 : 1) * ((+h * 60 + +m) * 60 + +s) * 1000;
};

const customTimeZone = (observances: Observance[]): CustomZone => {
  const offsets = new Set(observances.flatMap(({ from, to }) => [from, to]));
  const transition = (time: IcsTime, from: number, to: number): Transition =>
    ({ instant: wallStamp(time) - from, from, to });
  const transitions = observances.flatMap(({ start, rdates, from, to }) =>
    [start, ...rdates].map((time) => transition(time, from, to)));
  const sort = () => transitions.sort((a, b) => a.instant - b.instant);
  sort();

  const rules = observances.flatMap(({ start, rule, from, to }) => {
    if (!rule) return [];
    const until = rule.until?.utc ? timeAt(rule.until, new Date(wallStamp(rule.until) + from)) : rule.until;
    return [{ first: { ...start, utc: true }, rule: { ...rule, until }, from, to }];
  });
  let through = Math.min(...rules.map(({ first }) => dayNumber(first.y, first.mo, first.d))) - 1;
  const offsetAt = (instant: number): number => {
    // The transition time is given by the clock before the offset change. One year of margin covers the year boundary.
    const year = new Date(instant).getUTCFullYear();
    if (dayNumber(year + 1, 1, 1) > through) {
      const next = dayNumber(year + 2, 1, 1) - 1;
      for (const { first, rule, from, to } of rules) {
        for (const time of ruleStarts(first, rule, through + 1, next)) transitions.push(transition(time, from, to));
      }
      through = next;
      sort();
    }
    let lo = 0;
    let hi = transitions.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (transitions[mid].instant <= instant) lo = mid + 1;
      else hi = mid;
    }
    return lo ? transitions[lo - 1].to : transitions[0].from;
  };
  return {
    offsetAt,
    fromWall: (wall) => {
      let first = Infinity;
      for (const offset of offsets) {
        const at = wall - offset;
        if (offsetAt(at) === offset) first = Math.min(first, at);
      }
      if (Number.isFinite(first)) return first;
      const gap = transitions.find(({ instant, from, to }) => wall >= instant + from && wall < instant + to);
      return wall - (gap?.from ?? offsetAt(wall));
    },
  };
};

const readZones = (lines: Line[]): Map<string, CustomZone> => {
  const zones = new Map<string, CustomZone>();
  let zone: { id?: string; observances: Observance[] } | undefined;
  let current: Partial<Observance> | undefined;
  for (const line of lines) {
    const component = line.value.toUpperCase();
    if (line.name === "BEGIN" && component === "VTIMEZONE") {
      zone = { observances: [] };
    } else if (!zone) {
      continue;
    } else if (line.name === "END" && component === "VTIMEZONE") {
      if (zone.id && zone.observances.length) zones.set(zone.id, customTimeZone(zone.observances));
      zone = undefined;
      current = undefined;
    } else if (line.name === "BEGIN" && (component === "STANDARD" || component === "DAYLIGHT")) {
      current = { rdates: [] };
    } else if (line.name === "END" && (component === "STANDARD" || component === "DAYLIGHT")) {
      if (current?.start?.time && current.from !== undefined && current.to !== undefined) {
        zone.observances.push({ ...current, start: current.start, from: current.from, to: current.to, rdates: current.rdates ?? [] });
      }
      current = undefined;
    } else if (current) {
      switch (line.name) {
        case "DTSTART": current.start = parseTime(line.value) ?? undefined; break;
        case "TZOFFSETFROM": current.from = parseOffset(line.value); break;
        case "TZOFFSETTO": current.to = parseOffset(line.value); break;
        case "RRULE": current.rule = parseRule(line.value) ?? undefined; break;
        case "RDATE": current.rdates?.push(...listTimes(line)); break;
      }
    } else if (line.name === "TZID") {
      zone.id = unescapeText(line.value.trim());
    }
  }
  return zones;
};

/** Occurrence starts of the event that may touch the range (with a margin for the duration) */
export const occurrenceStarts = (e: IcsEvent, range: DateRange, durationMs: number): IcsTime[] => {
  const first = e.start;
  const rule = e.rrule ? parseRule(e.rrule) : null;
  const out: IcsTime[] = [first];
  if (rule) {
    const lastDay = Math.floor(range.end.getTime() / DAY_MS) + 2;
    const earliest = Math.floor((range.start.getTime() - Math.max(durationMs, 0)) / DAY_MS) - 2;
    // Old occurrences count toward COUNT, but not toward the limit of returned dates.
    let remaining = MAX_OCCURRENCES - Number(dayNumber(first.y, first.mo, first.d) >= earliest);
    for (const time of ruleStarts(first, rule, earliest, lastDay)) {
      out.push(time);
      if (--remaining === 0) break;
    }
  }
  for (const r of [...e.rdates, ...(e.periods ?? []).map(({ start }) => start)]) {
    if (!out.some((o) => sameMoment(o, r))) out.push(r);
  }
  return out.filter((t) => !e.exdates.some((x) => sameMoment(x, t)));
};

/** duration: DTEND, DURATION or the default (a day for all-day events, zero for the rest) */
const durationOf = (e: IcsEvent): Duration => {
  if (!e.start.time) {
    if (e.end && !e.end.time) return { ms: 0, days: Math.max(1, dayNumber(e.end.y, e.end.mo, e.end.d) - dayNumber(e.start.y, e.start.mo, e.start.d)) };
    return { ms: 0, days: Math.max(1, Math.round((e.durationMs ?? 0) / DAY_MS)) };
  }
  if (e.end) return { days: 0, ms: Math.max(0, toInstant(e.end).getTime() - toInstant(e.start).getTime()) };
  const days = Math.max(0, e.durationDays ?? 0);
  return { days, ms: Math.max(0, (e.durationMs ?? 0) - days * DAY_MS) };
};

const instanceKey = (t: IcsTime, at?: number): string =>
  t.time ? String(at ?? toInstant(t).getTime()) : `${t.y}-${t.mo}-${t.d}`;

const addCalendarDays = (time: IcsTime, days: number): IcsTime =>
  onDay(time, dayNumber(time.y, time.mo, time.d) + days);

/** App calendar event: read-only, not linked to Google */
const toEvent = (
  calendarId: string, account: string, e: IcsEvent, start: IcsTime, untitled: string, duration: Duration,
  begin = toInstant(start),
): CalendarEvent => {
  const nominalEnd = duration.days ? toInstant(addCalendarDays(start, duration.days)) : begin;
  const end = new Date(Math.max(begin.getTime(), nominalEnd.getTime() + duration.ms));
  const id = `${e.uid}_${instanceKey(start, begin.getTime())}`;
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
    // "repeats" in the card reads the rule from Google — a subscription doesn't have it there
    recurring: false,
    reminders: "default",
    organizerSelf: false,
  };
};

type RangeEdit = { event: IcsEvent; at: number; shift: number; duration?: Duration };

/** Calendar events from the file that touch the range: recurrences expanded, moved and cancelled ones accounted for */
export const expandIcs = (
  cal: IcsCalendar,
  range: DateRange,
  calendarId: string,
  account: string,
  untitled: string,
): CalendarEvent[] => {
  // moved occurrences by UID and original time
  const moved = new Map<string, IcsEvent>();
  const ranged = new Map<string, RangeEdit[]>();
  const masters = new Map<string, IcsEvent>();
  for (const e of cal.events) {
    const original = e.recurrenceId;
    if (!original) {
      if (!e.cancelled) masters.set(e.uid, e);
      continue;
    }
    moved.set(`${e.uid}\u0000${instanceKey(original)}`, e);
    if (!e.rangeFuture) continue;
    const at = toInstant(original).getTime();
    const shift = original.time ? toInstant(e.start).getTime() - at
      : wallStamp(e.start) - wallStamp(original);
    const edit = { event: e, at, shift };
    const list = ranged.get(e.uid);
    if (list) list.push(edit);
    else ranged.set(e.uid, [edit]);
  }
  for (const edits of ranged.values()) {
    edits.sort((a, b) => a.at - b.at);
    let duration: Duration | undefined;
    for (const edit of edits) {
      if (edit.event.end || edit.event.durationMs !== undefined) duration = durationOf(edit.event);
      edit.duration = duration;
    }
    edits.reverse();
  }

  const out: CalendarEvent[] = [];
  const add = (e: IcsEvent, start: IcsTime, duration = durationOf(e), begin?: Date) => {
    const event = toEvent(calendarId, account, e, start, untitled, duration, begin);
    if (event.start < range.end && (event.end > range.start || event.start >= range.start)) out.push(event);
  };
  for (const e of cal.events) {
    if (e.cancelled) continue;
    const edits = ranged.get(e.uid) ?? [];
    if (e.recurrenceId) {
      const edit = edits.find(({ event }) => event === e);
      const master = masters.get(e.uid);
      add(e, e.start, edit ? edit.duration ?? (master && durationOf(master)) : undefined);
      continue;
    }

    const duration = durationOf(e);
    const periods = new Map(e.periods?.map((period) => [instanceKey(period.start), period.duration]));
    const displacements = edits.map(({ shift }) => shift);
    const originalRange = {
      start: new Date(range.start.getTime() - Math.max(0, ...displacements)),
      end: new Date(range.end.getTime() - Math.min(0, ...displacements)),
    };
    const maxDuration = edits.reduce((max, edit) =>
      edit.duration ? Math.max(max, durationSize(edit.duration)) : max, durationSize(duration));
    for (const start of occurrenceStarts(e, originalRange, maxDuration)) {
      const original = toInstant(start);
      const at = original.getTime();
      const key = instanceKey(start, at);
      if (moved.has(`${e.uid}\u0000${key}`)) continue;
      const edit = edits.find((entry) => entry.at <= at);
      if (edit?.event.cancelled) continue;
      const length = edit?.duration ?? periods.get(key) ?? duration;
      if (!edit) {
        add(e, start, length, original);
      } else if (!start.time) {
        add(e, addCalendarDays(start, edit.shift / DAY_MS), length);
      } else {
        const begin = new Date(at + edit.shift);
        add(e, timeAt(edit.event.start, begin), length, begin);
      }
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
};
