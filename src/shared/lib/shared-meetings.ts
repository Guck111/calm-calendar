// One meeting both accounts were invited to: copies in different accounts share an iCalUID.
// Show it once; the remaining copy has the other calendars in alsoIn.
import type { CalendarEvent } from "../api/types";

/** series occurrences share an iCalUID, so they are also told apart by start */
const meetingKey = (e: CalendarEvent) => `${e.iCalUID}|${e.start.getTime()}`;

/**
 * @param events events of all calendars in account order
 * @param writable calendars where the event can be edited: keep such a copy if there is one
 */
export const mergeSharedMeetings = (events: CalendarEvent[], writable: Set<string>): CalendarEvent[] => {
  const groups = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    if (!e.iCalUID) continue;
    const key = meetingKey(e);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const keep = new Map<string, CalendarEvent>();
  for (const [key, copies] of groups) {
    // copies in one account (two of its calendars) are not merged: Google shows them the same way
    if (new Set(copies.map((c) => c.account)).size < 2) continue;
    const main = copies.find((c) => writable.has(c.calendarId)) ?? copies[0];
    const others = copies.filter((c) => c !== main && c.account !== main.account);
    keep.set(key, { ...main, alsoIn: others.map((c) => c.calendarId) });
  }
  if (!keep.size) return events;
  return events.flatMap((e) => {
    const merged = e.iCalUID ? keep.get(meetingKey(e)) : undefined;
    if (!merged) return [e];
    if (merged.key === e.key) return [merged];
    // a copy from the same account as the remaining one stays as is
    return e.account === merged.account ? [e] : [];
  });
};
