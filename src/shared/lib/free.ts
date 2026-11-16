// "Free time": gaps between events during working hours, as text for a messenger.
import type { CalendarEvent } from "../api/types";
import { locale, t } from "../i18n";
import { formatTime, formatWeekdayDayMonth, localTimeZone, startOfDay } from "./date";
import { busyStart } from "./conflicts";
import { isAllDayLike } from "./layout";
import { zoneCity, zoneShort } from "./tz";

export type FreeOptions = {
  /** start and end of the working day, minutes from midnight */
  from: number;
  to: number;
  /** shorter gaps are not shown, minutes */
  minLength: number;
  weekends: boolean;
};

export type Slot = { start: Date; end: Date };
export type FreeDay = { day: Date; slots: Slot[] };

/** gaps start on round quarter hours: "from 10:15", not "from 10:07" */
const STEP_MS = 15 * 60_000;
const ceilToStep = (d: Date): Date => new Date(Math.ceil(d.getTime() / STEP_MS) * STEP_MS);

/** region's weekend: Saturday and Sunday, but e.g. in Saudi Arabia — Friday and Saturday */
export const isWeekend = (d: Date): boolean => {
  try {
    const l = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { weekend: number[] };
      weekInfo?: { weekend: number[] };
    };
    const weekend = (l.getWeekInfo?.() ?? l.weekInfo)?.weekend;
    // in weekInfo Monday is 1, Sunday is 7
    if (weekend?.length) return weekend.includes(d.getDay() || 7);
  } catch {
    // old engine without weekInfo
  }
  return d.getDay() === 0 || d.getDay() === 6;
};

/** Everything counts as busy except all-day events and those marked "free"; travel to an event is busy too */
const busy = (e: CalendarEvent) => !isAllDayLike(e) && !e.free;

export const freeSlots = (events: CalendarEvent[], days: Date[], o: FreeOptions, now = new Date()): FreeDay[] => {
  const blocks = events
    .filter(busy)
    .map((e) => ({ start: busyStart(e).getTime(), end: e.end.getTime() }))
    .sort((a, b) => a.start - b.start);
  return days
    .filter((day) => startOfDay(day) >= startOfDay(now) && (o.weekends || !isWeekend(day)))
    .map((day) => {
      const at = (minutes: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes).getTime();
      const from = Math.max(at(o.from), ceilToStep(now).getTime());
      const to = at(o.to);
      const slots: Slot[] = [];
      let cursor = from;
      for (const b of blocks) {
        if (b.end <= cursor) continue;
        if (b.start >= to) break;
        if (b.start > cursor) slots.push({ start: new Date(cursor), end: new Date(Math.min(b.start, to)) });
        cursor = Math.max(cursor, b.end);
        if (cursor >= to) break;
      }
      if (cursor < to) slots.push({ start: new Date(cursor), end: new Date(to) });
      return { day, slots: slots.filter((s) => s.end.getTime() - s.start.getTime() >= o.minLength * 60_000) };
    })
    .filter((d) => d.slots.length);
};

/** "When I'm free (Warsaw, GMT+1):" and a line per day: "Mon, November 9: 09:00–11:00 and 15:00–18:00" */
export const formatFreeSlots = (days: FreeDay[], now = new Date(), zone = localTimeZone()): string => {
  if (!days.length) return t.free.none;
  const list = new Intl.ListFormat(locale, { type: "conjunction" });
  const lines = days.map(
    ({ day, slots }) =>
      `${formatWeekdayDayMonth(day)}: ${list.format(slots.map((s) => `${formatTime(s.start)}–${formatTime(s.end)}`))}`,
  );
  return [t.free.intro(`${zoneCity(zone)}, ${zoneShort(zone, now)}`), ...lines].join("\n");
};
