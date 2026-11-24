// Loading calendars and events: the real request handlers over a fake API, and how the stores react
import { allSettled, createWatch, fork, type Scope } from "effector";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../shared/api/calendar";
import { forgetFeeds } from "../shared/api/feeds";
import type { AuthStatus, Calendar, CalendarEvent } from "../shared/api/types";
import { t } from "../shared/i18n";
import { logError } from "../shared/lib/log";
import { fetchStatusFx, sessionLost, signOutFx } from "./auth";
import {
  $calendarById,
  $calendarsRequestId,
  $calendars,
  $failedAccounts,
  $visibleCalendars,
  $writableCalendars,
  calendarToggled,
  fetchCalendarsFx,
} from "./calendars";
import { $holidayRegion } from "./display";
import {
  $conflicts,
  $events,
  $eventsRequestId,
  $loadError,
  $loading,
  eventShifted,
  eventsHidden,
  eventsRestored,
  fetchEventsFx,
  hidingEnded,
  refreshRequested,
  reloadRequested,
  type Hidden,
} from "./events";
import { retryFx } from "./sync";
import { viewChanged } from "./view";

vi.mock("../shared/api/calendar", async (original) => ({
  ...(await original<typeof import("../shared/api/calendar")>()),
  listEvents: vi.fn(),
  listAllCalendars: vi.fn(),
}));
vi.mock("../shared/api/feeds", async (original) => ({
  ...(await original<typeof import("../shared/api/feeds")>()),
  forgetFeeds: vi.fn(),
}));
vi.mock("../shared/lib/log", async (original) => ({
  ...(await original<typeof import("../shared/lib/log")>()),
  logError: vi.fn(),
}));

const listEvents = vi.mocked(api.listEvents);
const listAllCalendars = vi.mocked(api.listAllCalendars);
afterEach(() => vi.clearAllMocks());

const range = { start: new Date(2026, 10, 9), end: new Date(2026, 10, 16) };
const cal = (id: string, account: string, over: Partial<Calendar> = {}): Calendar => ({
  id, googleId: id, account, name: id, color: "#000", textColor: "#fff", accessRole: "owner", primary: false,
  selected: true, defaultReminders: [], ...over,
});
const ev = (key: string, calendarId: string, account: string, h = 9, over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  key, id: key, calendarId, account, title: key, start: new Date(2026, 10, 10, h), end: new Date(2026, 10, 10, h + 1),
  allDay: false, recurring: false, ...over,
});
/** retries after a failure would load again and again: in these tests a failure stays a failure */
const noRetry: [typeof retryFx, () => Promise<never>] = [retryFx, async () => { throw new Error("no retries in tests"); }];
const signedIn: AuthStatus = { clientSource: "file", accounts: [{ email: "me@x", signedIn: true }] };
const watch = (scope: Scope, unit: Parameters<typeof createWatch>[0]["unit"]) => {
  const fn = vi.fn();
  createWatch({ unit, fn, scope });
  return fn;
};

describe("loading events from several calendars", () => {
  const personal = cal("personal", "me@x");
  const work = cal("work", "work@x");
  const lunch = ev("lunch", "personal", "me@x");

  it("a calendar that failed is named, the rest are shown, an expired sign-in is noticed", async () => {
    listEvents.mockImplementation(async (id) => {
      if (id === "personal") return [lunch];
      throw { kind: "not_signed_in", message: "expired" };
    });
    const { value } = await allSettled(fetchEventsFx, { scope: fork({ handlers: [noRetry] }), params: { calendars: [personal, work], range, id: 7 } });
    expect(value).toEqual({ events: [lunch], failed: ["work"], lost: true, id: 7 });
  });

  it("another kind of failure is not an expired sign-in", async () => {
    listEvents.mockImplementation(async (id) => {
      if (id === "personal") return [];
      throw { kind: "network", message: "offline" };
    });
    const { value } = await allSettled(fetchEventsFx, { scope: fork({ handlers: [noRetry] }), params: { calendars: [personal, work], range, id: 1 } });
    expect(value).toMatchObject({ failed: ["work"], lost: false });
  });

  it("when every calendar failed, the first error is the failure", async () => {
    listEvents.mockRejectedValueOnce(new Error("first")).mockRejectedValueOnce(new Error("second"));
    const result = await allSettled(fetchEventsFx, { scope: fork({ handlers: [noRetry] }), params: { calendars: [personal, work], range, id: 1 } });
    expect(result).toEqual({ status: "fail", value: { kind: "other", message: "first" } });
  });

  it("no calendars is an empty week, not a failure", async () => {
    const result = await allSettled(fetchEventsFx, { scope: fork({ handlers: [noRetry] }), params: { calendars: [], range, id: 1 } });
    expect(result).toEqual({ status: "done", value: { events: [], failed: [], lost: false, id: 1 } });
  });

  it("of a meeting in two accounts the copy in an owned or writable calendar is kept", async () => {
    for (const role of ["owner", "writer"] as const) {
      const shared = cal("shared", "me@x", { accessRole: "reader" });
      const own = cal("own", "work@x", { accessRole: role });
      listEvents.mockImplementation(async (id) => [ev(`copy-${id}`, id, id === "own" ? "work@x" : "me@x", 9, { iCalUID: "x" })]);
      const { value } = await allSettled(fetchEventsFx, { scope: fork({ handlers: [noRetry] }), params: { calendars: [shared, own], range, id: 1 } });
      expect((value as { events: CalendarEvent[] }).events.map((e) => e.key)).toEqual(["copy-own"]);
    }
  });
});

describe("what the events store shows", () => {
  const load = (scope: Scope, id = 1) =>
    allSettled(fetchEventsFx, { scope, params: { calendars: [], range, id } });
  const scopeWith = (events: CalendarEvent[]) =>
    fork({ handlers: [noRetry, [fetchEventsFx, ({ id }: { id: number }) => ({ events, failed: [], lost: false, id })], [signOutFx, async () => undefined]] });
  const a = ev("a", "c", "me@x");
  const copy = ev("a-copy", "d", "me@x", 9, { id: "a" });
  const hidden: Hidden = { key: "del", calendarId: "c", id: "a" };

  it("an event deleted on screen stays hidden in a new load until restored, only in its own calendar", async () => {
    const scope = scopeWith([a, copy]);
    await allSettled(eventsHidden, { scope, params: hidden });
    await load(scope);
    expect(scope.getState($events).map((e) => e.key)).toEqual(["a-copy"]);
    await allSettled(eventsRestored, { scope, params: { hidden, events: [a] } });
    await load(scope);
    expect(scope.getState($events).map((e) => e.key)).toEqual(["a", "a-copy"]);
  });

  it("restoring one deletion keeps the other hidden", async () => {
    const b = ev("b", "c", "me@x", 11);
    const other: Hidden = { key: "del-b", calendarId: "c", id: "b" };
    const scope = scopeWith([a, b]);
    await allSettled(eventsHidden, { scope, params: hidden });
    await allSettled(eventsHidden, { scope, params: other });
    await allSettled(eventsRestored, { scope, params: { hidden, events: [a] } });
    await load(scope);
    expect(scope.getState($events).map((e) => e.key)).toEqual(["a"]);
  });

  it("when the deletion reached Google, the list is taken as is", async () => {
    const scope = scopeWith([a]);
    await allSettled(eventsHidden, { scope, params: hidden });
    await allSettled(hidingEnded, { scope, params: "other" });
    await load(scope);
    expect(scope.getState($events)).toEqual([]);
    await allSettled(hidingEnded, { scope, params: "del" });
    await load(scope);
    expect(scope.getState($events)).toEqual([a]);
  });

  it("a moved event changes only itself, overlaps between accounts are found", async () => {
    const work = ev("w", "work", "work@x", 9);
    const scope = scopeWith([a, work]);
    await load(scope);
    expect(scope.getState($conflicts).get("a")?.map((e) => e.key)).toEqual(["w"]);
    const start = new Date(2026, 10, 10, 14);
    const end = new Date(2026, 10, 10, 15);
    await allSettled(eventShifted, { scope, params: { key: "a", start, end } });
    expect(scope.getState($events).map((e) => [e.key, e.start.getHours()])).toEqual([["a", 14], ["w", 9]]);
  });

  it("sign-out makes any answer on the way stale", async () => {
    const scope = scopeWith([]);
    await load(scope, 5);
    await allSettled(signOutFx, { scope, params: undefined });
    expect(scope.getState($eventsRequestId)).toBe(6);
  });

  it("is loading while events are on the way", async () => {
    let finish!: () => void;
    const scope = fork({ handlers: [noRetry, [fetchEventsFx, () => new Promise((ok) => (finish = () => ok({ events: [], failed: [], lost: false, id: 1 })))]] });
    const request = allSettled(fetchEventsFx, { scope, params: { calendars: [], range, id: 1 } });
    await Promise.resolve();
    expect(scope.getState($loading)).toBe(true);
    finish();
    await request;
    expect(scope.getState($loading)).toBe(false);
  });
});

describe("load errors", () => {
  it("names the calendars that failed, then the request error, then a calendar list error", async () => {
    const scope = fork({
      handlers: [noRetry, 
        [fetchEventsFx, ({ id }: { id: number }) =>
          id === 1 ? { events: [], failed: ["Work", "Home"], lost: false, id } : Promise.reject({ kind: "network", message: "Offline" })],
        [fetchCalendarsFx, () => Promise.reject({ kind: "timeout", message: "Too slow" })],
      ],
    });
    await allSettled(fetchEventsFx, { scope, params: { calendars: [], range, id: 1 } });
    expect(scope.getState($loadError)).toBe(t.errors.calendarsFailed("Work, Home"));
    await allSettled(fetchEventsFx, { scope, params: { calendars: [], range, id: 2 } });
    expect(scope.getState($loadError)).toBe("Offline");
    await allSettled(fetchCalendarsFx, { scope, params: { accounts: ["me@x"], id: 1 } });
    expect(scope.getState($loadError)).toBe("Too slow");
  });

  it("names the accounts whose calendars didn't load", async () => {
    const scope = fork({ handlers: [noRetry, [fetchCalendarsFx, async () => ({ calendars: [], failed: ["a@x", "b@x"], lost: [] })]] });
    await allSettled(fetchCalendarsFx, { scope, params: { accounts: ["a@x", "b@x"], id: 1 } });
    expect(scope.getState($failedAccounts)).toEqual(["a@x", "b@x"]);
    expect(scope.getState($loadError)).toBe(t.errors.accountsFailed("a@x, b@x"));
  });

  it("an expired or missing sign-in ends the session, other failures don't; UI failures are logged", async () => {
    for (const [kind, lost] of [["not_signed_in", 1], ["not_configured", 1], ["network", 0], ["other", 0]] as const) {
      const scope = fork({ handlers: [noRetry, [fetchEventsFx, () => Promise.reject({ kind, message: kind })]] });
      const session = watch(scope, sessionLost);
      await allSettled(fetchEventsFx, { scope, params: { calendars: [], range, id: 1 } });
      expect(session).toHaveBeenCalledTimes(lost);
    }
    expect(vi.mocked(logError)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logError)).toHaveBeenCalledWith("loading events failed", { kind: "other", message: "other" });
  });

  it("a failed calendar list of the 'other' kind is logged, and calendars or events with an expired account end the session", async () => {
    const scope = fork({
      handlers: [noRetry, 
        [fetchCalendarsFx, ({ id }: { id: number }) =>
          id === 1 ? Promise.reject({ kind: "other", message: "bug" }) : { calendars: [], failed: [], lost: ["me@x"] }],
        [fetchEventsFx, ({ id }: { id: number }) => ({ events: [], failed: [], lost: true, id })],
        // the session check after a lost sign-in finds nobody signed in, so nothing loads again
        [fetchStatusFx, async () => ({ clientSource: "file" as const, accounts: [] })],
      ],
    });
    const session = watch(scope, sessionLost);
    await allSettled(fetchCalendarsFx, { scope, params: { accounts: ["me@x"], id: 1 } });
    expect(vi.mocked(logError)).toHaveBeenCalledWith("loading calendars failed", { kind: "other", message: "bug" });
    await allSettled(fetchCalendarsFx, { scope, params: { accounts: ["me@x"], id: 2 } });
    await allSettled(fetchEventsFx, { scope, params: { calendars: [], range, id: 1 } });
    expect(session).toHaveBeenCalledTimes(2);
  });
});

describe("what starts a load", () => {
  const personal = cal("personal", "me@x");

  it("signing in loads calendars, then events; paging, reload and refresh load again", async () => {
    const calendarsFx = vi.fn(async () => ({ calendars: [personal], failed: [], lost: [] }));
    const eventsFx = vi.fn(async ({ id }: { id: number; calendars: Calendar[] }) => ({ events: [], failed: [], lost: false, id }));
    const scope = fork({ handlers: [noRetry, [fetchStatusFx, async () => signedIn], [fetchCalendarsFx, calendarsFx], [fetchEventsFx, eventsFx]] });
    await allSettled(fetchStatusFx, { scope });
    expect(calendarsFx).toHaveBeenCalledWith({ accounts: ["me@x"], id: 1 });
    expect(eventsFx.mock.calls.map(([p]) => [p.calendars.map((c) => c.id), p.id])).toEqual([[["personal"], 1]]);
    await allSettled(viewChanged, { scope, params: "day" });
    await allSettled(reloadRequested, { scope });
    expect(eventsFx.mock.calls.map(([p]) => p.id)).toEqual([1, 2, 3]);
    await allSettled(refreshRequested, { scope });
    expect(calendarsFx).toHaveBeenLastCalledWith({ accounts: ["me@x"], id: 2 });
    expect(vi.mocked(forgetFeeds)).toHaveBeenCalledTimes(1);
  });

  it("nothing loads while signed out", async () => {
    const calendarsFx = vi.fn();
    const eventsFx = vi.fn();
    const scope = fork({
      handlers: [noRetry, [fetchStatusFx, async () => ({ clientSource: "file", accounts: [{ email: "me@x", signedIn: false }] })], [fetchCalendarsFx, calendarsFx], [fetchEventsFx, eventsFx]],
    });
    await allSettled(fetchStatusFx, { scope });
    await allSettled(reloadRequested, { scope });
    expect([calendarsFx.mock.calls.length, eventsFx.mock.calls.length]).toEqual([0, 0]);
  });

  it("the real calendar request asks the API for the active accounts", async () => {
    listAllCalendars.mockResolvedValue({ calendars: [personal], failed: [], lost: [] });
    await allSettled(fetchCalendarsFx, { scope: fork({ handlers: [noRetry] }), params: { accounts: ["me@x"], id: 1 } });
    expect(listAllCalendars).toHaveBeenCalledWith(["me@x"]);
  });
});

describe("calendar list", () => {
  const owner = cal("owner", "me@x");
  const writer = cal("writer", "me@x", { accessRole: "writer" });
  const reader = cal("reader", "me@x", { accessRole: "reader" });
  let stored: Map<string, string>;

  beforeEach(() => {
    stored = new Map();
    vi.stubGlobal("localStorage", { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v) });
  });
  afterEach(() => vi.unstubAllGlobals());

  const loaded = async (calendars: Calendar[], values: [typeof $holidayRegion, string][] = []) => {
    const scope = fork({ values, handlers: [noRetry, [fetchStatusFx, async () => signedIn], [fetchCalendarsFx, async () => ({ calendars, failed: [], lost: [] })], [fetchEventsFx, async ({ id }: { id: number }) => ({ events: [], failed: [], lost: false, id })]] });
    await allSettled(fetchStatusFx, { scope });
    return scope;
  };

  it("loaded calendars are listed with the holiday calendar, writable ones are owned or writer, all found by id", async () => {
    const scope = await loaded([owner, writer, reader], [[$holidayRegion, "PL"]]);
    expect(scope.getState($calendars).map((c) => c.id)).toEqual(["owner", "writer", "reader", "me@x\u0000ru.polish#holiday@group.v.calendar.google.com"]);
    expect(scope.getState($writableCalendars).map((c) => c.id)).toEqual(["owner", "writer"]);
    expect(scope.getState($calendarById).get("writer")).toBe(writer);
  });

  it("a calendar switched off in Google can be switched on", async () => {
    const off = cal("off", "me@x", { selected: false });
    const scope = await loaded([owner, off]);
    await allSettled(calendarToggled, { scope, params: "off" });
    expect(scope.getState($visibleCalendars).map((c) => c.id)).toEqual(["owner", "off"]);
  });

  it("sign-out makes a calendar answer on the way stale", async () => {
    const scope = fork({ handlers: [noRetry, [signOutFx, async () => undefined], [fetchStatusFx, async () => ({ clientSource: "file" as const, accounts: [] })],
      [fetchCalendarsFx, async () => ({ calendars: [], failed: [], lost: [] })]] });
    await allSettled(fetchCalendarsFx, { scope, params: { accounts: ["me@x"], id: 4 } });
    await allSettled(signOutFx, { scope, params: undefined });
    expect(scope.getState($calendarsRequestId)).toBe(5);
  });

  it("a calendar switched off is hidden and remembered, a calendar not in the list is switched off too", async () => {
    const scope = await loaded([owner, reader]);
    await allSettled(calendarToggled, { scope, params: "reader" });
    expect(scope.getState($visibleCalendars).map((c) => c.id)).toEqual(["owner"]);
    await allSettled(calendarToggled, { scope, params: "gone" });
    expect(JSON.parse(stored.get("calm.calendarVisibility") ?? "{}")).toEqual({ reader: false, gone: false });
  });

  it("a calendar list answer to an older request is dropped, whether it succeeded or failed", async () => {
    let failOld!: (e: unknown) => void;
    const scope = fork({ handlers: [noRetry, [fetchCalendarsFx, ({ id }: { id: number }) =>
      id === 1 ? new Promise((_, fail) => (failOld = fail)) : { calendars: [owner], failed: [], lost: [] }]] });
    const old = allSettled(fetchCalendarsFx, { scope, params: { accounts: ["me@x"], id: 1 } });
    const latest = allSettled(fetchCalendarsFx, { scope, params: { accounts: ["me@x"], id: 2 } });
    failOld({ kind: "network", message: "old failure" });
    await Promise.all([old, latest]);
    expect(scope.getState($calendars).map((c) => c.id)).toEqual(["owner"]);
    expect(scope.getState($loadError)).toBeNull();
  });
});
