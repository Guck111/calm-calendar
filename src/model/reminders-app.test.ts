// Reminders inside the app: the schedule sent to Rust, the window of two days and what starts a load
import { allSettled, fork } from "effector";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../shared/api/calendar";
import type { Calendar, CalendarEvent } from "../shared/api/types";
import { t } from "../shared/i18n";
import { fetchStatusFx } from "./auth";
import { fetchCalendarsFx } from "./calendars";
import { reloadRequested } from "./events";
import { buildAlerts, buildReminders, loadReminderEventsFx, sendRemindersFx } from "./reminders";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("../shared/api/bus", () => ({ inTauri: true, broadcast: vi.fn(), subscribe: vi.fn(() => () => {}), openMain: vi.fn() }));
vi.mock("../shared/api/calendar", async (original) => ({ ...(await original<typeof import("../shared/api/calendar")>()), listEvents: vi.fn() }));
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

const now = new Date(2026, 10, 4, 12);
const ev = (minutesFromNow: number, over: Partial<CalendarEvent> = {}): CalendarEvent => {
  const start = new Date(now.getTime() + minutesFromNow * 60_000);
  return { key: `k${minutesFromNow}`, id: "e", calendarId: "c", account: "me@x", title: "Call", start, end: new Date(start.getTime() + 3_600_000), allDay: false, recurring: false, reminders: [0], ...over };
};
const cal = { id: "c", defaultReminders: [15] } as Calendar;

describe("reminder texts and window", () => {
  it("a day before says 'in 1 day', two days 'in 2 days'", () => {
    const [day] = buildReminders([ev(24 * 60, { reminders: [24 * 60] })], [cal], now);
    expect(day.body.startsWith(t.reminders.inDays(1))).toBe(true);
    const [two] = buildReminders([ev(47 * 60, { reminders: [2880] })], [cal], new Date(now.getTime() - 60 * 60_000));
    expect(two.body.startsWith(t.reminders.inDays(2))).toBe(true);
  });

  it("an event without its own reminders uses the calendar's, an all-day one gets none", () => {
    expect(buildReminders([ev(30, { reminders: undefined })], [cal], now).map((r) => r.at)).toEqual([now.getTime() + 15 * 60_000]);
    expect(buildReminders([ev(30, { reminders: undefined, allDay: true })], [cal], now)).toEqual([]);
  });

  it("the window includes a minute ago and exactly two days ahead", () => {
    expect(buildReminders([ev(-1), ev(48 * 60)], [cal], now)).toHaveLength(2);
    expect(buildReminders([ev(-2), ev(48 * 60 + 1)], [cal], now)).toHaveLength(0);
    expect(buildAlerts([ev(0), ev(48 * 60 + 1)], now)).toHaveLength(2);
    expect(buildAlerts([ev(-1), ev(48 * 60 + 2)], now)).toHaveLength(0);
  });

  it("the private text has no place, the full one has", () => {
    const [r] = buildReminders([ev(0, { location: "Room 4" })], [cal], now);
    expect(r.body.endsWith(" · Room 4")).toBe(true);
    expect(r.privateBody).toBe(r.body.replace(" · Room 4", ""));
  });
});

describe("schedule sent to the app", () => {
  it("loads events of two days around now, by calendar, naming those that failed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    vi.mocked(api.listEvents).mockImplementation(async (id) => {
      if (id === "bad") throw new Error("offline");
      return [ev(30)];
    });
    const { value } = await allSettled(loadReminderEventsFx, { scope: fork(), params: { calendars: [{ id: "c" }, { id: "bad" }] as Calendar[], id: 1 } });
    expect(value).toEqual({ byCalendar: { c: [ev(30)] }, failed: ["bad"] });
    expect(vi.mocked(api.listEvents)).toHaveBeenCalledWith("c", { start: new Date(now.getTime() - 60_000), end: new Date(now.getTime() + 48 * 3_600_000) });
  });

  it("reminders and alerts go to Rust with its field names", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const meeting = ev(30, { meeting: { url: "https://meet.google.com/abc-defg-hij", provider: "Google Meet" } });
    const { value } = await allSettled(sendRemindersFx, { scope: fork(), params: { events: [meeting], calendars: [cal] } });
    expect(value).toBe(1);
    const { items } = vi.mocked(invoke).mock.calls[0][1] as { items: Record<string, unknown>[] };
    expect(vi.mocked(invoke).mock.calls[0][0]).toBe("schedule_reminders");
    expect(items).toEqual([
      expect.objectContaining({ title: "Call", private_title: t.reminders.privateTitle, join_label: t.meeting.join, url: meeting.meeting?.url }),
      expect.objectContaining({ title: "Call", body: "", alert: true, join_label: t.meeting.join, provider: "Google Meet" }),
    ]);
    expect(items[0]).not.toHaveProperty("privateTitle");
  });

  it("signing in, a calendar change and a reload load the schedule again with a new number; nothing while signed out", async () => {
    const load = vi.fn(async ({ id }: { id: number }) => ({ byCalendar: {}, failed: [] as string[], id }));
    const scope = fork({ handlers: [
      [fetchStatusFx, async () => ({ clientSource: "file", accounts: [{ email: "me@x", signedIn: true }] })],
      [fetchCalendarsFx, async () => ({ calendars: [{ id: "c", selected: true } as Calendar], failed: [], lost: [] })],
      [loadReminderEventsFx, load], [sendRemindersFx, async () => 0],
    ] });
    await allSettled(fetchStatusFx, { scope });
    await allSettled(reloadRequested, { scope });
    expect(load.mock.calls.map(([p]) => p.id)).toEqual([1, 2]);
    const signedOut = fork({ handlers: [[loadReminderEventsFx, load]] });
    await allSettled(reloadRequested, { scope: signedOut });
    expect(load).toHaveBeenCalledTimes(2);
  });
});
