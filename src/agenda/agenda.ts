// Agenda for the tray icon window: today and tomorrow, all-day events on top.
import type { CalendarEvent } from "../shared/api/types";
import { addDays, startOfDay } from "../shared/lib/date";
import { overlapsDay } from "../shared/lib/layout";

export type AgendaDay = { day: Date; events: CalendarEvent[] };

const byTime = (a: CalendarEvent, b: CalendarEvent) =>
  Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime() || a.title.localeCompare(b.title);

export const agendaDays = (events: CalendarEvent[], now: Date): AgendaDay[] => {
  const today = startOfDay(now);
  return [today, addDays(today, 1)].map((day) => ({
    day,
    events: events.filter((e) => overlapsDay(e, day)).sort(byTime),
  }));
};

/** past event today is shown faded, not hidden: you can see the day has already happened */
export const isPast = (e: CalendarEvent, now: Date): boolean => !e.allDay && e.end <= now;
export const isNow = (e: CalendarEvent, now: Date): boolean => !e.allDay && e.start <= now && now < e.end;
