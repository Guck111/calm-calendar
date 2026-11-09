// Одна встреча, на которую позвали оба аккаунта: у копий в разных аккаунтах общий iCalUID.
// Показываем её один раз; у оставшейся копии в alsoIn — календари остальных.
import type { CalendarEvent } from "../api/types";

/** у повторений серии iCalUID общий, поэтому различаем их ещё и по началу */
const meetingKey = (e: CalendarEvent) => `${e.iCalUID}|${e.start.getTime()}`;

/**
 * @param events события всех календарей в порядке аккаунтов
 * @param writable календари, где событие можно править: такую копию оставляем, если она есть
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
    // копии в одном аккаунте (два его календаря) не объединяем: так же показывает и Google
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
    // копия того же аккаунта, что и оставшаяся, остаётся как есть
    return e.account === merged.account ? [e] : [];
  });
};
