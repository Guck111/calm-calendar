// «Свободное время»: окна между событиями в рабочие часы, текстом для мессенджера.
import type { CalendarEvent } from "../api/types";
import { locale, t } from "../i18n";
import { addMinutes, formatTime, formatWeekdayDayMonth, localTimeZone, startOfDay } from "./date";
import { busyStart } from "./conflicts";
import { isAllDayLike } from "./layout";
import { zoneCity, zoneShort } from "./tz";

export type FreeOptions = {
  /** начало и конец рабочего дня, минуты от полуночи */
  from: number;
  to: number;
  /** окна короче не показываем, минуты */
  minLength: number;
  weekends: boolean;
};

export type Slot = { start: Date; end: Date };
export type FreeDay = { day: Date; slots: Slot[] };

/** окна начинаются с ровных четверти часа: «с 10:15», а не «с 10:07» */
const STEP_MS = 15 * 60_000;
const ceilToStep = (d: Date): Date => new Date(Math.ceil(d.getTime() / STEP_MS) * STEP_MS);

/** выходные региона: суббота и воскресенье, а, например, в Саудовской Аравии — пятница и суббота */
export const isWeekend = (d: Date): boolean => {
  try {
    const l = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { weekend: number[] };
      weekInfo?: { weekend: number[] };
    };
    const weekend = (l.getWeekInfo?.() ?? l.weekInfo)?.weekend;
    // в weekInfo понедельник — 1, воскресенье — 7
    if (weekend?.length) return weekend.includes(d.getDay() || 7);
  } catch {
    // старый движок без weekInfo
  }
  return d.getDay() === 0 || d.getDay() === 6;
};

/** Занятым считаем всё, кроме событий на весь день и отмеченных «свободен»; дорога до события тоже занята */
const busy = (e: CalendarEvent) => !isAllDayLike(e) && !e.free;

export const freeSlots = (events: CalendarEvent[], days: Date[], o: FreeOptions, now = new Date()): FreeDay[] => {
  const blocks = events
    .filter(busy)
    .map((e) => ({ start: busyStart(e).getTime(), end: e.end.getTime() }))
    .sort((a, b) => a.start - b.start);
  return days
    .filter((day) => startOfDay(day) >= startOfDay(now) && (o.weekends || !isWeekend(day)))
    .map((day) => {
      const dayStart = startOfDay(day);
      let from = addMinutes(dayStart, o.from).getTime();
      const to = addMinutes(dayStart, o.to).getTime();
      from = Math.max(from, ceilToStep(now).getTime());
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

/** «Когда я свободен (Warsaw, GMT+1):» и по строке на день: «Пн, 9 ноября: 09:00–11:00 и 15:00–18:00» */
export const formatFreeSlots = (days: FreeDay[], now = new Date(), zone = localTimeZone()): string => {
  if (!days.length) return t.free.none;
  const list = new Intl.ListFormat(locale, { type: "conjunction" });
  const lines = days.map(
    ({ day, slots }) =>
      `${formatWeekdayDayMonth(day)}: ${list.format(slots.map((s) => `${formatTime(s.start)}–${formatTime(s.end)}`))}`,
  );
  return [t.free.intro(`${zoneCity(zone)}, ${zoneShort(zone, now)}`), ...lines].join("\n");
};
