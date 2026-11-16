// Overlaps of events from different Google accounts: a work meeting at the same time as a personal one.
// Within one account we don't look for overlaps: such events already sit side by side in one calendar.
import type { CalendarEvent } from "../api/types";

/** Start of busy time: including travel to the event */
export const busyStart = (e: CalendarEvent): Date =>
  e.travelMinutes ? new Date(e.start.getTime() - e.travelMinutes * 60_000) : e.start;

/** event key → events of other accounts it overlaps */
export type Conflicts = Map<string, CalendarEvent[]>;

/** All-day events and those marked "free" don't take time; the same meeting
 *  both accounts were invited to (shared iCalUID) is not an overlap */
const clash = (a: CalendarEvent, b: CalendarEvent): boolean =>
  a.account !== b.account && !(a.iCalUID && a.iCalUID === b.iCalUID) && busyStart(a) < b.end && busyStart(b) < a.end;

export const findConflicts = (events: CalendarEvent[]): Conflicts => {
  const timed = events
    .filter((e) => !e.allDay && !e.free)
    .sort((a, b) => busyStart(a).getTime() - busyStart(b).getTime());
  const out: Conflicts = new Map();
  const add = (key: string, other: CalendarEvent) => out.set(key, [...(out.get(key) ?? []), other]);
  for (let i = 0; i < timed.length; i++) {
    // events are sorted by start: no need to look past this event's end
    for (let j = i + 1; j < timed.length && busyStart(timed[j]) < timed[i].end; j++) {
      if (!clash(timed[i], timed[j])) continue;
      add(timed[i].key, timed[j]);
      add(timed[j].key, timed[i]);
    }
  }
  return out;
};
