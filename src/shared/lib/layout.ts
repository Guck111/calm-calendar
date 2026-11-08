// Раскладка событий: какие события попадают в день и как разместить
// пересекающиеся события в сетке времени без наложения.
import type { CalendarEvent } from "../api/types";
import { locale } from "../i18n";
import { addDays, MINUTES_IN_DAY, startOfDay } from "./date";

export const overlapsDay = (e: CalendarEvent, day: Date): boolean => {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  return e.start < dayEnd && e.end > dayStart;
};

/** На весь день, а также события на 24 часа и дольше: их показываем в верхней полосе */
export const isAllDayLike = (e: CalendarEvent): boolean =>
  e.allDay || e.end.getTime() - e.start.getTime() >= MINUTES_IN_DAY * 60_000;

export const byStart = (a: CalendarEvent, b: CalendarEvent): number =>
  Number(b.allDay) - Number(a.allDay) ||
  a.start.getTime() - b.start.getTime() ||
  b.end.getTime() - a.end.getTime() ||
  a.title.localeCompare(b.title, locale);

export const eventsForDay = (events: CalendarEvent[], day: Date): CalendarEvent[] =>
  events.filter((e) => overlapsDay(e, day)).sort(byStart);

export type PlacedEvent = {
  event: CalendarEvent;
  /** минуты от начала дня, обрезанные границами дня */
  startMin: number;
  endMin: number;
  column: number;
  columns: number;
};

/** Короткие события растягиваем, чтобы по ним можно было попасть мышью */
const MIN_DURATION = 20;

export const layoutDay = (events: CalendarEvent[], day: Date): PlacedEvent[] => {
  const dayStart = startOfDay(day).getTime();
  const toMin = (d: Date) => Math.round((d.getTime() - dayStart) / 60_000);

  const items = events
    .filter((e) => !isAllDayLike(e) && overlapsDay(e, day))
    .map((event) => {
      const startMin = Math.max(0, toMin(event.start));
      const endMin = Math.min(MINUTES_IN_DAY, Math.max(toMin(event.end), startMin + MIN_DURATION));
      return { event, startMin, endMin };
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  const placed: PlacedEvent[] = [];
  // группа — цепочка событий, которые пересекаются между собой хотя бы попарно
  let group: PlacedEvent[] = [];
  let columnEnds: number[] = [];
  let groupEnd = -1;

  const closeGroup = () => {
    const columns = columnEnds.length;
    group.forEach((p) => placed.push({ ...p, columns }));
    group = [];
    columnEnds = [];
  };

  items.forEach((item) => {
    if (item.startMin >= groupEnd && group.length) closeGroup();
    const free = columnEnds.findIndex((end) => end <= item.startMin);
    const column = free === -1 ? columnEnds.length : free;
    columnEnds[column] = item.endMin;
    group.push({ ...item, column, columns: 0 });
    groupEnd = Math.max(groupEnd, item.endMin);
  });
  if (group.length) closeGroup();

  return placed;
};
