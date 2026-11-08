// Расписание напоминаний: события на двое суток вперёд → моменты показа → Rust.
import { invoke } from "@tauri-apps/api/core";
import { t } from "../shared/i18n";
import { createEffect, sample } from "effector";
import { inTauri } from "../shared/api/bus";
import { listEvents } from "../shared/api/calendar";
import type { Calendar, CalendarEvent } from "../shared/api/types";
import { formatTime } from "../shared/lib/date";
import { $signedIn } from "./auth";
import { $visibleCalendars } from "./calendars";
import { reloadRequested } from "./events";

const WINDOW_MS = 48 * 60 * 60_000;

export type Reminder = {
  key: string;
  title: string;
  body: string;
  privateTitle: string;
  privateBody: string;
  at: number;
  /** ссылка на видеовстречу: в уведомлении появится кнопка «Подключиться» */
  url?: string;
  joinLabel?: string;
};

const before = (minutes: number): string => {
  if (minutes === 0) return t.reminders.startsNow;
  if (minutes < 24 * 60) return t.reminders.in(t.time.span(Math.floor(minutes / 60), minutes % 60));
  return t.reminders.inDays(Math.round(minutes / 1440));
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
      const when = e.allDay ? t.common.allDay : `${formatTime(e.start)}–${formatTime(e.end)}`;
      return [
        {
          key: `${e.key}\u0000${e.start.getTime()}\u0000${m}`,
          title: e.title,
          body: `${before(m)} · ${when}${e.location ? ` · ${e.location}` : ""}`,
          privateTitle: t.reminders.privateTitle,
          privateBody: `${before(m)} · ${when}`,
          at,
          ...(e.meeting ? { url: e.meeting.url, joinLabel: t.meeting.join } : {}),
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
  const payload = items.map(({ privateTitle, privateBody, joinLabel, ...r }) => ({
    ...r,
    private_title: privateTitle,
    private_body: privateBody,
    join_label: joinLabel,
  }));
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
