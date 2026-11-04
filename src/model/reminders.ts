// Расписание напоминаний: события на двое суток вперёд → моменты показа → Rust.
import { invoke } from "@tauri-apps/api/core";
import { createEffect, sample } from "effector";
import { inTauri } from "../shared/api/bus";
import { listEvents } from "../shared/api/calendar";
import type { Calendar, CalendarEvent } from "../shared/api/types";
import { formatTime } from "../shared/lib/date";
import { $signedIn } from "./auth";
import { $visibleCalendars } from "./calendars";
import { reloadRequested } from "./events";

const WINDOW_MS = 48 * 60 * 60_000;

export type Reminder = { key: string; title: string; body: string; privateBody: string; at: number };

const before = (minutes: number): string => {
  if (minutes === 0) return "Начинается сейчас";
  if (minutes < 60) return `Через ${minutes} мин`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h < 24) return m ? `Через ${h} ч ${m} мин` : `Через ${h} ч`;
  const d = Math.round(minutes / 1440);
  return `Через ${d} дн.`;
};

/** Чистая функция: из событий и настроек календарей — список напоминаний */
export const buildReminders = (
  events: CalendarEvent[],
  calendars: Pick<Calendar, "id" | "defaultReminders">[],
  now: Date,
): Reminder[] => {
  const defaults = new Map(calendars.map((c) => [c.id, c.defaultReminders]));
  return events.flatMap((e) => {
    // у событий на весь день свои настройки по умолчанию, API их не отдаёт — берём только явные
    const minutes =
      e.reminders === "default" || e.reminders === undefined
        ? e.allDay
          ? []
          : (defaults.get(e.calendarId) ?? [])
        : e.reminders;
    return [...new Set(minutes)].flatMap((m) => {
      const at = e.start.getTime() - m * 60_000;
      if (at < now.getTime() - 60_000 || at > now.getTime() + WINDOW_MS) return [];
      const when = e.allDay ? "Весь день" : `${formatTime(e.start)}–${formatTime(e.end)}`;
      return [
        {
          key: `${e.key}\u0000${e.start.getTime()}\u0000${m}`,
          title: e.title,
          body: `${before(m)} · ${when}${e.location ? ` · ${e.location}` : ""}`,
          privateBody: `${before(m)} · ${when}`,
          at,
        },
      ];
    });
  });
};

export const scheduleRemindersFx = createEffect(async (calendars: Calendar[]) => {
  const now = new Date();
  const range = { start: new Date(now.getTime() - 60_000), end: new Date(now.getTime() + WINDOW_MS) };
  const results = await Promise.allSettled(calendars.map((c) => listEvents(c.id, range)));
  const events = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const items = buildReminders(events, calendars, now);
  // в Rust поля называются по-другому (snake_case)
  const payload = items.map(({ privateBody, ...r }) => ({ ...r, private_body: privateBody }));
  if (inTauri) await invoke("schedule_reminders", { items: payload });
  return items.length;
});

// календари перечитываются при запуске, по кнопке «обновить» и раз в 5 минут
sample({
  clock: [$visibleCalendars.updates, reloadRequested],
  source: { signedIn: $signedIn, calendars: $visibleCalendars },
  filter: ({ signedIn }) => signedIn,
  fn: ({ calendars }) => calendars,
  target: scheduleRemindersFx,
});
