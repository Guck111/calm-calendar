// @vitest-environment jsdom
// The widget model end to end on mocked Google requests: sign-in status → calendars → nearest events and month dots
import { allSettled, fork, type Scope } from "effector";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAuthStatus } from "../shared/api/bridge";
import { listAllCalendars, listEvents } from "../shared/api/calendar";
import { forgetFeeds } from "../shared/api/feeds";
import type { AppError, AuthStatus, Calendar, CalendarEvent } from "../shared/api/types";
import { addDays, addMonths, monthGrid, startOfDay, startOfMonth } from "../shared/lib/date";
import { FEEDS_KEY } from "../shared/lib/feeds";
import { HOLIDAYS_KEY } from "../shared/lib/holidays";
import {
  $accounts,
  $calendars,
  $calendarsTried,
  $colors,
  $error,
  $loading,
  $monthEvents,
  $now,
  $signedIn,
  $status,
  $today,
  $upcoming,
  VISIBILITY_KEY,
  authChanged,
  fetchCalendarsFx,
  fetchMonthFx,
  fetchStatusFx,
  fetchUpcomingFx,
  minuteTicked,
  monthShifted,
  refreshRequested,
  widgetStarted,
  $month,
} from "./model";

vi.mock("../shared/api/bridge", async (original) => ({ ...(await original()), getAuthStatus: vi.fn() }));
vi.mock("../shared/api/feeds", async (original) => ({ ...(await original()), forgetFeeds: vi.fn() }));
vi.mock("../shared/api/calendar", async (original) => ({
  ...(await original()),
  listAllCalendars: vi.fn(),
  listEvents: vi.fn(),
}));

const ME = "me@example.com";
const OTHER = "old@example.com";

const calendar = (googleId: string, over: Partial<Calendar> = {}): Calendar => ({
  id: `${ME}\u0000${googleId}`,
  googleId,
  account: ME,
  name: googleId,
  color: `#${googleId.length}0${googleId.length}0${googleId.length}0`,
  textColor: "#ffffff",
  accessRole: "owner",
  primary: false,
  selected: true,
  defaultReminders: [],
  ...over,
});

const event = (title: string, calendarId = calendar("primary").id): CalendarEvent => ({
  key: title,
  id: title,
  calendarId,
  account: ME,
  title,
  start: new Date(2026, 10, 11, 10),
  end: new Date(2026, 10, 11, 11),
  allDay: false,
  recurring: false,
});

const status = (accounts: { email: string; signedIn: boolean }[], clientSource: AuthStatus["clientSource"] = "build"): AuthStatus => ({
  clientSource,
  accounts,
});
const signedIn = status([
  { email: ME, signedIn: true },
  { email: OTHER, signedIn: false },
]);

const error = (kind: AppError["kind"], message: string = kind): AppError => ({ kind, message });

const authStatus = vi.mocked(getAuthStatus);
const allCalendars = vi.mocked(listAllCalendars);
const events = vi.mocked(listEvents);

const titles = (list: CalendarEvent[]) => list.map((e) => e.title);

beforeEach(() => {
  authStatus.mockResolvedValue(signedIn);
  allCalendars.mockResolvedValue({ calendars: [calendar("primary")], failed: [], lost: [] });
  events.mockImplementation(async (id) => [event(`from ${id.split("\u0000")[1]}`, id)]);
});

afterEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
});

const started = async () => {
  const scope = fork();
  await allSettled(widgetStarted, { scope });
  return scope;
};

describe("calendars of the widget", () => {
  it("are those of signed-in accounts, as enabled in the main window, with holidays and subscriptions", async () => {
    allCalendars.mockResolvedValue({
      calendars: [
        calendar("primary"),
        calendar("hidden-by-id"),
        calendar("hidden-by-google-id"),
        calendar("unselected", { selected: false }),
        calendar("shown-by-setting", { selected: false }),
      ],
      failed: [],
      lost: [],
    });
    localStorage.setItem(
      VISIBILITY_KEY,
      JSON.stringify({ [`${ME}\u0000hidden-by-id`]: false, "hidden-by-google-id": false, "shown-by-setting": true, "off-feed": false }),
    );
    localStorage.setItem(HOLIDAYS_KEY, JSON.stringify("PL"));
    localStorage.setItem(
      FEEDS_KEY,
      JSON.stringify([
        { id: "on-feed", url: "https://a.test/a.ics", name: "Sport", color: "#123456" },
        { id: "off-feed", url: "https://a.test/b.ics", name: "Hidden", color: "#654321" },
        { id: "broken" },
      ]),
    );
    const scope = await started();
    expect(allCalendars).toHaveBeenCalledWith([ME]);
    const list = scope.getState($calendars);
    expect(list.map((c) => c.googleId)).toEqual([
      "primary",
      "shown-by-setting",
      expect.stringContaining(".polish#holiday@"),
      "on-feed",
    ]);
    expect(list[2]).toMatchObject({ holiday: true, account: ME });
    expect(list[3]).toMatchObject({ feed: true, name: "Sport", color: "#123456" });
    expect(scope.getState($colors)).toEqual(Object.fromEntries(list.map((c) => [c.id, c.color])));
    expect(scope.getState($calendarsTried)).toBe(true);
  });

  it("have no holiday calendar without a country", async () => {
    const scope = await started();
    expect(scope.getState($calendars).map((c) => c.googleId)).toEqual(["primary"]);
  });

  it("are not asked for while nobody is signed in", async () => {
    for (const s of [status([{ email: ME, signedIn: false }]), status([{ email: ME, signedIn: true }], "none"), status([])]) {
      authStatus.mockResolvedValue(s);
      const scope = await started();
      expect(scope.getState($signedIn)).toBe(false);
      expect(scope.getState($accounts)).toEqual([]);
      expect(scope.getState($calendarsTried)).toBe(false);
    }
    expect(allCalendars).not.toHaveBeenCalled();
  });
});

describe("events of the widget", () => {
  it("are the nearest 45 days from every calendar and the dots of the month grid", async () => {
    allCalendars.mockResolvedValue({ calendars: [calendar("primary"), calendar("team")], failed: [], lost: [] });
    const scope = await started();
    expect(scope.getState($status)).toEqual(signedIn);
    expect(scope.getState($accounts)).toEqual([ME]);
    expect(scope.getState($signedIn)).toBe(true);

    const today = scope.getState($today);
    const grid = monthGrid(scope.getState($month));
    expect(events.mock.calls.map(([id, range]) => [id.split("\u0000")[1], range])).toEqual([
      ["primary", { start: today, end: addDays(today, 45) }],
      ["team", { start: today, end: addDays(today, 45) }],
      ["primary", { start: grid[0], end: addDays(grid[41], 1) }],
      ["team", { start: grid[0], end: addDays(grid[41], 1) }],
    ]);
    expect(titles(scope.getState($upcoming))).toEqual(["from primary", "from team"]);
    expect(titles(scope.getState($monthEvents))).toEqual(["from primary", "from team"]);
    expect(scope.getState($error)).toBeNull();
  });

  it("keep the calendars that answered when others failed", async () => {
    allCalendars.mockResolvedValue({ calendars: [calendar("primary"), calendar("team")], failed: [], lost: [] });
    events.mockImplementation(async (id) => {
      if (id.endsWith("team")) throw error("network");
      return [event("kept", id)];
    });
    const scope = await started();
    expect(titles(scope.getState($upcoming))).toEqual(["kept"]);
    expect(scope.getState($error)).toBeNull();
  });

  it("report the first error when every calendar failed", async () => {
    allCalendars.mockResolvedValue({ calendars: [calendar("primary"), calendar("team")], failed: [], lost: [] });
    events.mockImplementation(async (id) => {
      throw error("network", `down: ${id.split("\u0000")[1]}`);
    });
    const scope = await started();
    expect(scope.getState($error)).toBe("down: primary");
    expect(scope.getState($upcoming)).toEqual([]);
  });

  it("are empty, not an error, with no calendars", async () => {
    allCalendars.mockResolvedValue({ calendars: [], failed: [], lost: [] });
    const scope = await started();
    expect(scope.getState($upcoming)).toEqual([]);
    expect(scope.getState($error)).toBeNull();
    expect(events).not.toHaveBeenCalled();
  });
});

describe("errors in the widget", () => {
  it("show why the calendars did not load, and clear once events arrive", async () => {
    allCalendars.mockRejectedValueOnce(error("network", "offline"));
    const scope = await started();
    expect(scope.getState($error)).toBe("offline");
    expect(scope.getState($calendarsTried)).toBe(true);
    await allSettled(refreshRequested, { scope });
    expect(scope.getState($error)).toBeNull();
    expect(titles(scope.getState($upcoming))).toEqual(["from primary"]);
  });

  it("ask for the sign-in status again when Google no longer accepts the sign-in", async () => {
    const scope = await started();
    expect(authStatus).toHaveBeenCalledTimes(1);
    allCalendars.mockRejectedValueOnce(error("not_signed_in"));
    await allSettled(refreshRequested, { scope });
    expect(authStatus).toHaveBeenCalledTimes(2);

    // the app marks the account signed out by then, or the widget would ask forever
    events.mockRejectedValue(error("not_signed_in"));
    authStatus.mockResolvedValue(status([{ email: ME, signedIn: false }]));
    await allSettled(refreshRequested, { scope });
    expect(authStatus).toHaveBeenCalledTimes(3);
    expect(scope.getState($signedIn)).toBe(false);
  });

  it("other failures do not ask for the status again", async () => {
    const scope = await started();
    allCalendars.mockRejectedValueOnce(error("network"));
    await allSettled(refreshRequested, { scope });
    events.mockRejectedValue(error("network"));
    await allSettled(refreshRequested, { scope });
    expect(authStatus).toHaveBeenCalledTimes(1);
  });

  it("of an older request are not shown over a newer list", async () => {
    let fail!: (e: AppError) => void;
    let succeed!: (v: CalendarEvent[]) => void;
    const scope = fork({
      handlers: [
        [
          fetchUpcomingFx,
          ({ today }: { today: Date }) =>
            new Promise<CalendarEvent[]>((ok, reject) => (today.getDate() === 1 ? (fail = reject) : (succeed = ok))),
        ],
      ],
    });
    const first = allSettled(fetchUpcomingFx, { scope, params: { calendars: [], today: new Date(2026, 10, 1) } });
    const second = allSettled(fetchUpcomingFx, { scope, params: { calendars: [], today: new Date(2026, 10, 2) } });
    succeed([event("new")]);
    await new Promise((tick) => setTimeout(tick));
    fail(error("network", "late"));
    await Promise.all([first, second]);
    expect(scope.getState($error)).toBeNull();
    expect(titles(scope.getState($upcoming))).toEqual(["new"]);
  });
});

describe("signing out in the widget", () => {
  it("clears calendars and events", async () => {
    const scope = await started();
    expect(scope.getState($calendars)).not.toEqual([]);
    authStatus.mockResolvedValue(status([{ email: ME, signedIn: false }]));
    await allSettled(authChanged, { scope });
    expect(scope.getState($calendars)).toEqual([]);
    expect(scope.getState($upcoming)).toEqual([]);
    expect(scope.getState($monthEvents)).toEqual([]);
    expect(scope.getState($calendarsTried)).toBe(false);
  });

  it("does not happen while some account is still signed in", async () => {
    const scope = await started();
    allCalendars.mockRejectedValueOnce(error("network"));
    await allSettled(authChanged, { scope });
    expect(scope.getState($calendars).map((c) => c.googleId)).toEqual(["primary"]);
    expect(titles(scope.getState($upcoming))).toEqual(["from primary"]);
    expect(titles(scope.getState($monthEvents))).toEqual(["from primary"]);
  });
});

describe("time in the widget", () => {
  it("a new minute of the same day reloads nothing", async () => {
    const scope = await started();
    const calls = allCalendars.mock.calls.length;
    const later = new Date(scope.getState($today).getTime() + 60_000);
    await allSettled(minuteTicked, { scope, params: later });
    expect(scope.getState($now)).toEqual(later);
    expect(allCalendars).toHaveBeenCalledTimes(calls);
    expect(forgetFeeds).not.toHaveBeenCalled();
  });

  it("a new day returns to the current month and reloads with subscriptions", async () => {
    const scope = await started();
    await allSettled(monthShifted, { scope, params: 1 });
    const tomorrow = addDays(scope.getState($today), 1);
    await allSettled(minuteTicked, { scope, params: new Date(tomorrow.getTime() + 60_000) });
    expect(scope.getState($today)).toEqual(tomorrow);
    expect(scope.getState($month)).toEqual(startOfMonth(new Date()));
    expect(forgetFeeds).toHaveBeenCalledTimes(1);
    expect(allCalendars).toHaveBeenCalledTimes(2);
    expect(events).toHaveBeenCalledWith(expect.anything(), { start: tomorrow, end: addDays(tomorrow, 45) });
  });

  it("a new day reloads nothing while signed out", async () => {
    authStatus.mockResolvedValue(status([]));
    const scope = await started();
    await allSettled(minuteTicked, { scope, params: addDays(startOfDay(new Date()), 1) });
    expect(forgetFeeds).not.toHaveBeenCalled();
    expect(allCalendars).not.toHaveBeenCalled();
  });
});

describe("paging months in the widget", () => {
  it("hides the old dots and loads the new month", async () => {
    const scope = await started();
    let finish!: (v: CalendarEvent[]) => void;
    events.mockImplementation(() => new Promise((ok) => (finish = ok)));
    const paging = allSettled(monthShifted, { scope, params: 1 });
    expect(scope.getState($monthEvents)).toEqual([]);
    finish([event("next month")]);
    await paging;
    const grid = monthGrid(addMonths(startOfMonth(new Date()), 1));
    expect(events).toHaveBeenLastCalledWith(expect.anything(), { start: grid[0], end: addDays(grid[41], 1) });
    expect(titles(scope.getState($monthEvents))).toEqual(["next month"]);
  });

  it("does not load dots while signed out", async () => {
    authStatus.mockResolvedValue(status([]));
    const scope = await started();
    await allSettled(monthShifted, { scope, params: 1 });
    expect(events).not.toHaveBeenCalled();
  });

  it("ignores the dots of a month already paged past", async () => {
    const month = startOfMonth(new Date());
    const scope = fork({
      handlers: [[fetchMonthFx, ({ month: m }: { month: Date }) => ({ month: m, events: [event("stale")] })]],
    });
    await allSettled(fetchMonthFx, { scope, params: { calendars: [], month: addMonths(month, 1) } });
    expect(scope.getState($monthEvents)).toEqual([]);
    await allSettled(fetchMonthFx, { scope, params: { calendars: [], month } });
    expect(titles(scope.getState($monthEvents))).toEqual(["stale"]);
  });
});

describe("loading in the widget", () => {
  it("is shown while the nearest events load", async () => {
    let finish!: (v: CalendarEvent[]) => void;
    const scope: Scope = fork({ handlers: [[fetchUpcomingFx, () => new Promise((ok) => (finish = ok))]] });
    const loading = allSettled(fetchUpcomingFx, { scope, params: { calendars: [], today: new Date() } });
    expect(scope.getState($loading)).toBe(true);
    finish([]);
    await loading;
    expect(scope.getState($loading)).toBe(false);
  });

  it("the status and calendar requests are the real ones", async () => {
    const scope = fork();
    await allSettled(fetchStatusFx, { scope });
    expect(authStatus).toHaveBeenCalledTimes(1);
    await allSettled(fetchCalendarsFx, { scope, params: [ME] });
    expect(scope.getState($calendars).map((c) => c.googleId)).toEqual(["primary"]);
  });
});
