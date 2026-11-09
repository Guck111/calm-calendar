// Пересечения событий из разных аккаунтов Google: встреча по работе в то же время, что личная.
// Внутри одного аккаунта пересечения не ищем: такие события и так стоят рядом в одном календаре.
import type { CalendarEvent } from "../api/types";

/** Начало занятого времени: вместе с дорогой до события */
export const busyStart = (e: CalendarEvent): Date =>
  e.travelMinutes ? new Date(e.start.getTime() - e.travelMinutes * 60_000) : e.start;

/** ключ события → события других аккаунтов, с которыми оно пересекается */
export type Conflicts = Map<string, CalendarEvent[]>;

/** События на весь день и отмеченные «свободен» не занимают время; одна и та же встреча,
 *  на которую позвали оба аккаунта (общий iCalUID), — не пересечение */
const clash = (a: CalendarEvent, b: CalendarEvent): boolean =>
  a.account !== b.account && !(a.iCalUID && a.iCalUID === b.iCalUID) && busyStart(a) < b.end && busyStart(b) < a.end;

export const findConflicts = (events: CalendarEvent[]): Conflicts => {
  const timed = events
    .filter((e) => !e.allDay && !e.free)
    .sort((a, b) => busyStart(a).getTime() - busyStart(b).getTime());
  const out: Conflicts = new Map();
  const add = (key: string, other: CalendarEvent) => out.set(key, [...(out.get(key) ?? []), other]);
  for (let i = 0; i < timed.length; i++) {
    // события отсортированы по началу: дальше начала этого события после его конца смотреть незачем
    for (let j = i + 1; j < timed.length && busyStart(timed[j]) < timed[i].end; j++) {
      if (!clash(timed[i], timed[j])) continue;
      add(timed[i].key, timed[j]);
      add(timed[j].key, timed[i]);
    }
  }
  return out;
};
