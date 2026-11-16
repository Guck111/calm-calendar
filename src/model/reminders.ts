// Reminder schedule: events two days ahead → show times → Rust.
import { invoke } from "@tauri-apps/api/core";
import { t } from "../shared/i18n";
import { createEffect, createStore, sample } from "effector";
import { inTauri } from "../shared/api/bus";
import { listEvents } from "../shared/api/calendar";
import type { Calendar, CalendarEvent } from "../shared/api/types";
import { formatTime } from "../shared/lib/date";
import { $signedIn, signOutFx } from "./auth";
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
  /** video meeting link: the notification gets a "Join" button */
  url?: string;
  joinLabel?: string;
};

const before = (minutes: number): string => {
  if (minutes === 0) return t.reminders.startsNow;
  if (minutes < 24 * 60) return t.reminders.in(t.time.span(Math.floor(minutes / 60), minutes % 60));
  return t.reminders.inDays(Math.round(minutes / 1440));
};

/** Pure function: from events and calendar settings to a list of reminders */
export const buildReminders = (
  events: CalendarEvent[],
  calendars: Pick<Calendar, "id" | "defaultReminders">[],
  now: Date,
): Reminder[] => {
  const defaults = new Map(calendars.map((c) => [c.id, c.defaultReminders]));
  return events.flatMap((e) => {
    // all-day events have their own defaults that the API doesn't return — take only explicit ones
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

/** Prominent reminders: a window on top of all windows a minute before the start. Whether to show it is decided
 *  by Rust from a setting (off, video meetings only, all events), so build them for all */
export const ALERT_BEFORE_MS = 60_000;

export type Alert = Pick<Reminder, "key" | "title" | "at" | "url"> & { start: number; end: number; provider?: string };

export const buildAlerts = (events: CalendarEvent[], now: Date): Alert[] =>
  events.flatMap((e) => {
    const at = e.start.getTime() - ALERT_BEFORE_MS;
    if (e.allDay || at < now.getTime() - 60_000 || at > now.getTime() + WINDOW_MS) return [];
    return [
      {
        key: `${e.key}\u0000${e.start.getTime()}\u0000alert`,
        title: e.title,
        at,
        start: e.start.getTime(),
        end: e.end.getTime(),
        ...(e.meeting ? { url: e.meeting.url, provider: e.meeting.provider } : {}),
      },
    ];
  });

type ReminderRequest = { calendars: Calendar[]; id: number };
/** events of each calendar that answered; failed — calendars that didn't */
type ReminderLoad = { byCalendar: Record<string, CalendarEvent[]>; failed: string[] };

export const loadReminderEventsFx = createEffect<ReminderRequest, ReminderLoad>(async ({ calendars }) => {
  const now = Date.now();
  const range = { start: new Date(now - 60_000), end: new Date(now + WINDOW_MS) };
  const results = await Promise.allSettled(calendars.map((c) => listEvents(c.id, range)));
  const byCalendar: Record<string, CalendarEvent[]> = {};
  const failed: string[] = [];
  results.forEach((r, i) => (r.status === "fulfilled" ? (byCalendar[calendars[i].id] = r.value) : failed.push(calendars[i].id)));
  return { byCalendar, failed };
});

/** the schedule goes to Rust as a whole and replaces the previous one */
export const sendRemindersFx = createEffect(async ({ events, calendars }: { events: CalendarEvent[]; calendars: Calendar[] }) => {
  const now = new Date();
  const items = buildReminders(events, calendars, now);
  // in Rust the fields are named differently (snake_case)
  const payload = items.map(({ privateTitle, privateBody, joinLabel, ...r }) => ({
    ...r,
    private_title: privateTitle,
    private_body: privateBody,
    join_label: joinLabel,
  }));
  const alerts = buildAlerts(events, now).map((a) => ({ ...a, body: "", alert: true, join_label: t.meeting.join }));
  if (inTauri) await invoke("schedule_reminders", { items: [...payload, ...alerts] });
  return items.length;
});

/** number of the latest load: a late answer of an older one doesn't replace a newer schedule */
const $requestId = createStore(0).on(loadReminderEventsFx, (_, r) => r.id);

/** Events of each calendar from its last successful load. A calendar that failed now (no network, Google busy)
 *  keeps its earlier events, so its reminders are not dropped from the schedule */
export const $reminderEvents = createStore<Record<string, CalendarEvent[]>>({}).reset(signOutFx.finally);

const loaded = sample({
  clock: loadReminderEventsFx.done,
  source: { latest: $requestId, known: $reminderEvents },
  filter: ({ latest }, { params }) => params.id === latest,
  fn: ({ known }, { params, result }) => {
    // calendars no longer shown are dropped; failed ones keep what was known
    const next = Object.fromEntries(
      params.calendars.flatMap((c) => {
        const events = result.byCalendar[c.id] ?? known[c.id];
        return events ? [[c.id, events] as const] : [];
      }),
    );
    return { calendars: params.calendars, known: next };
  },
});
$reminderEvents.on(loaded, (_, r) => r.known);

sample({
  clock: loaded,
  fn: ({ calendars, known }) => ({ calendars, events: Object.values(known).flat() }),
  target: sendRemindersFx,
});

// calendars are reloaded on start, by the "refresh" button and every 5 minutes
sample({
  clock: [$visibleCalendars.updates, reloadRequested],
  source: { signedIn: $signedIn, calendars: $visibleCalendars, id: $requestId },
  filter: ({ signedIn }) => signedIn,
  fn: ({ calendars, id }) => ({ calendars, id: id + 1 }),
  target: loadReminderEventsFx,
});
