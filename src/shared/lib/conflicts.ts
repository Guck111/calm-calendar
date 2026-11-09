// Пересечения событий из разных аккаунтов Google: встреча по работе в то же время, что личная.
// Внутри одного аккаунта пересечения не ищем: такие события и так стоят рядом в одном календаре.
import type { CalendarEvent } from "../api/types";

/** ключ события → события других аккаунтов, с которыми оно пересекается */
export type Conflicts = Map<string, CalendarEvent[]>;

/** События на весь день и отмеченные «свободен» не занимают время; одна и та же встреча,
 *  на которую позвали оба аккаунта (общий iCalUID), — не пересечение */
const clash = (a: CalendarEvent, b: CalendarEvent): boolean =>
  a.account !== b.account && !(a.iCalUID && a.iCalUID === b.iCalUID) && a.start < b.end && b.start < a.end;

export const findConflicts = (events: CalendarEvent[]): Conflicts => {
  const timed = events.filter((e) => !e.allDay && !e.free).sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: Conflicts = new Map();
  const add = (key: string, other: CalendarEvent) => out.set(key, [...(out.get(key) ?? []), other]);
  for (let i = 0; i < timed.length; i++) {
    // события отсортированы по началу: дальше начала этого события после его конца смотреть незачем
    for (let j = i + 1; j < timed.length && timed[j].start < timed[i].end; j++) {
      if (!clash(timed[i], timed[j])) continue;
      add(timed[i].key, timed[j]);
      add(timed[j].key, timed[i]);
    }
  }
  return out;
};
