// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { allSettled, fork, type Scope } from "effector";
import { Provider } from "effector-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { $offlineSince } from "../model/connection";
import type { AuthStatus, Calendar, CalendarEvent } from "../shared/api/types";
import { setLang } from "../shared/i18n";
import { formatTime } from "../shared/lib/date";
import { CALENDARS, ME, MINE, SHARED, event } from "../ui/app-scope.test-utils";
import {
  $month,
  $now,
  $today,
  fetchCalendarsFx,
  fetchMonthFx,
  fetchStatusFx,
  fetchUpcomingFx,
  monthShifted,
  widgetStarted,
} from "./model";
import { Widget } from "./Widget";

const mocks = vi.hoisted(() => ({
  tauri: false,
  openMain: vi.fn((_date?: string) => {}),
  broadcast: vi.fn((_name: string, _payload?: unknown) => {}),
  listeners: new Map<string, () => void>(),
  openExternal: vi.fn(async (_url: string) => {}),
  saveEvent: vi.fn(async (_draft: object) => {}),
  setSize: vi.fn(async (_size: unknown) => {}),
  startDragging: vi.fn(async () => {}),
}));
vi.mock("../shared/api/bus", async (real) => ({
  ...(await real<object>()),
  get inTauri() {
    return mocks.tauri;
  },
  openMain: mocks.openMain,
  broadcast: mocks.broadcast,
  subscribe: (name: string, handler: () => void) => {
    mocks.listeners.set(name, handler);
    return () => mocks.listeners.delete(name);
  },
}));
vi.mock("../shared/api/open", () => ({ openExternal: mocks.openExternal }));
vi.mock("../shared/api/calendar", async (real) => ({ ...(await real<object>()), saveEvent: mocks.saveEvent }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setSize: mocks.setSize, startDragging: mocks.startDragging }),
  LogicalSize: class {
    constructor(
      public width: number,
      public height: number,
    ) {}
  },
}));

// Wednesday, November 11, 2026, 12:00
const NOW = new Date(2026, 10, 11, 12, 0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
  vi.setSystemTime(NOW);
  setLang("en");
  localStorage.clear();
  mocks.tauri = false;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  mocks.listeners.clear();
  setLang("ru");
});

const signedIn: AuthStatus = { clientSource: "build", accounts: [{ email: ME, signedIn: true }] };

type Setup = {
  status?: AuthStatus;
  calendars?: Calendar[];
  upcoming?: CalendarEvent[] | Error;
  month?: CalendarEvent[];
  offlineSince?: number;
};

const flush = () => act(async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
});

const show = async ({ status = signedIn, calendars = CALENDARS, upcoming = [], month = [], offlineSince }: Setup = {}) => {
  const loads = { upcoming: vi.fn(), month: vi.fn() };
  const scope: Scope = fork({
    values: [[$now, NOW], [$today, new Date(2026, 10, 11)], [$month, new Date(2026, 10, 1)], ...(offlineSince ? [[$offlineSince, offlineSince]] : [])] as never,
    handlers: [
      [fetchStatusFx, async () => status],
      [fetchCalendarsFx, async () => calendars],
      [
        fetchUpcomingFx,
        async () => {
          loads.upcoming();
          if (upcoming instanceof Error) throw { kind: "network", message: upcoming.message };
          return upcoming;
        },
      ],
      [fetchMonthFx, async ({ month: m }: { month: Date }) => (loads.month(m), { month: m, events: month })],
    ] as never,
  });
  await allSettled(widgetStarted, { scope });
  const view = render(
    <Provider value={scope}>
      <Widget />
    </Provider>,
  );
  await flush();
  return { scope, loads, container: view.container };
};

const days = () => screen.getAllByRole("button", { name: /^\d+$/ }).filter((b) => b.title === "Open the day in the calendar");
const dayOf = (n: number) => days().find((b) => b.textContent === String(n) && !b.className.includes("outside")) as HTMLElement;
const timed = (key: string, title: string, start: Date, end: Date, over: Partial<CalendarEvent> = {}) =>
  event({ key, id: key, title, start, end, ...over });

describe("clock and date", () => {
  it("the time and the date; the clock opens the calendar", async () => {
    await show();
    const clock = screen.getByRole("button", { name: /12:00/ });
    expect(clock.title).toBe("Open calendar");
    expect(clock.textContent).toBe("12:00PM");
    expect(screen.getByText("Wednesday, November 11")).toBeTruthy();
    fireEvent.click(clock);
    expect(mocks.openMain).toHaveBeenCalledWith();
  });

  it("a 24-hour language shows no AM or PM", async () => {
    setLang("de");
    const { container } = await show();
    expect(container.querySelector("[class*=period]")).toBeNull();
  });

  it("the clock moves on at the next minute and then every minute", async () => {
    vi.setSystemTime(new Date(2026, 10, 11, 12, 0, 30));
    await show();
    act(() => void vi.advanceTimersByTime(30_050));
    expect(screen.getByRole("button", { name: /12:01/ })).toBeTruthy();
    act(() => void vi.advanceTimersByTime(60_000));
    expect(screen.getByRole("button", { name: /12:02/ })).toBeTruthy();
  });
});

describe("the month", () => {
  it("the grid of the month: other months' days apart, today marked, days with events dotted", async () => {
    await show({ month: [timed("a", "Gym", new Date(2026, 10, 20, 18), new Date(2026, 10, 20, 19))] });
    expect(screen.getByText("November 2026")).toBeTruthy();
    expect(days()).toHaveLength(42);
    expect(dayOf(11).className).toContain("today");
    expect(dayOf(12).className).not.toContain("today");
    expect(dayOf(20).querySelector("[class*=dot]")).not.toBeNull();
    expect(dayOf(21).querySelector("[class*=dot]")).toBeNull();
    expect(days().filter((d) => d.className.includes("outside")).length).toBeGreaterThan(0);
  });

  it("a day opens it in the calendar", async () => {
    await show();
    fireEvent.click(dayOf(20));
    expect(mocks.openMain).toHaveBeenCalledWith("2026-11-20");
  });

  it("arrows page the months and load each; the title brings the current month back", async () => {
    const { loads } = await show();
    const title = screen.getByRole("button", { name: "November 2026" }) as HTMLButtonElement;
    expect(title.disabled).toBe(true);
    expect(title.title).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    await flush();
    const december = screen.getByRole("button", { name: "December 2026" }) as HTMLButtonElement;
    expect(december.disabled).toBe(false);
    expect(december.title).toBe("Back to the current month");
    expect(december.className).toContain("monthOther");
    expect(loads.month).toHaveBeenLastCalledWith(new Date(2026, 11, 1));
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "October 2026" }));
    await flush();
    expect(screen.getByRole("button", { name: "November 2026" })).toBeTruthy();
  });
});

describe("upcoming events", () => {
  it("not signed in: a hint that opens the calendar, no quick add", async () => {
    await show({ status: { clientSource: "build", accounts: [] } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in to Google in the calendar window" }));
    expect(mocks.openMain).toHaveBeenCalledWith();
    expect(screen.queryByRole("textbox", { name: "Quick add an event" })).toBeNull();
  });

  it("before the status is known nothing is said", async () => {
    const scope = fork({ handlers: [[fetchStatusFx, () => new Promise(() => {})]] as never });
    render(
      <Provider value={scope}>
        <Widget />
      </Provider>,
    );
    await flush();
    expect(screen.queryByText(/Sign in|No upcoming|Loading/)).toBeNull();
  });

  it("nothing ahead says so; a load error offers to retry", async () => {
    await show();
    expect(screen.getByText("No upcoming events")).toBeTruthy();
    cleanup();
    const { loads } = await show({ upcoming: new Error("offline") });
    const retry = screen.getByRole("button", { name: "Couldn't load events. Retry" });
    const before = loads.upcoming.mock.calls.length;
    fireEvent.click(retry);
    await flush();
    expect(loads.upcoming.mock.calls.length).toBe(before + 1);
  });

  it("while loading it says so", async () => {
    const scope = fork({
      values: [[$now, NOW], [$today, new Date(2026, 10, 11)], [$month, new Date(2026, 10, 1)]] as never,
      handlers: [
        [fetchStatusFx, async () => signedIn],
        [fetchCalendarsFx, async () => CALENDARS],
        [fetchUpcomingFx, () => new Promise(() => {})],
        [fetchMonthFx, async ({ month }: { month: Date }) => ({ month, events: [] })],
      ] as never,
    });
    render(
      <Provider value={scope}>
        <Widget />
      </Provider>,
    );
    await flush();
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("the next five, sorted, all-day first on a day; ended ones left out", async () => {
    const at = (d: number, h: number) => new Date(2026, 10, d, h);
    await show({
      upcoming: [
        timed("f", "Later", at(16, 9), at(16, 10)),
        timed("b", "Lunch", at(11, 13), at(11, 14)),
        timed("x", "Over", at(11, 9), at(11, 10)),
        timed("c", "Dinner", at(12, 19), at(12, 20)),
        timed("a", "Trip", new Date(2026, 10, 10), new Date(2026, 10, 13), { allDay: true }),
        timed("d", "Holiday", new Date(2026, 10, 12), new Date(2026, 10, 13), { allDay: true }),
        timed("e", "Gym", at(13, 18), at(13, 19)),
      ],
    });
    const rows = within(screen.getByRole("list")).getAllByRole("listitem").map((li) => li.textContent);
    expect(rows).toEqual([
      "TodayTrip",
      `Today ${formatTime(at(11, 13))}Lunch`,
      "TomorrowHoliday",
      `Tomorrow ${formatTime(at(12, 19))}Dinner`,
      `Fri, 13 ${formatTime(at(13, 18))}Gym`,
    ]);
  });

  it("a row opens its day; one that started earlier opens today", async () => {
    await show({
      upcoming: [
        timed("a", "Trip", new Date(2026, 10, 10), new Date(2026, 10, 13), { allDay: true }),
        timed("b", "Gym", new Date(2026, 10, 13, 18), new Date(2026, 10, 13, 19)),
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: /Trip/ }));
    expect(mocks.openMain).toHaveBeenLastCalledWith("2026-11-11");
    fireEvent.click(screen.getByRole("button", { name: /Gym/ }));
    expect(mocks.openMain).toHaveBeenLastCalledWith("2026-11-13");
  });

  it("rows take the event color, then the calendar color", async () => {
    await show({
      calendars: [{ ...CALENDARS[0], color: "#123456" }],
      upcoming: [
        timed("a", "Mine", new Date(2026, 10, 12, 9), new Date(2026, 10, 12, 10)),
        timed("b", "Red", new Date(2026, 10, 12, 11), new Date(2026, 10, 12, 12), { colorId: "11" }),
        timed("c", "Unknown", new Date(2026, 10, 12, 13), new Date(2026, 10, 12, 14), { calendarId: "gone" }),
      ],
    });
    const c = (name: string) => screen.getByRole("button", { name: new RegExp(name) }).style.getPropertyValue("--c");
    expect(c("Mine")).toBe("#123456");
    expect(c("Red")).not.toBe("#123456");
    expect(c("Red")).toMatch(/^#/);
    expect(c("Unknown")).toBe("var(--accent)");
  });
});

describe("the next meeting", () => {
  const call = (start: Date, end: Date) =>
    timed("m", "Standup", start, end, { meeting: { provider: "Google Meet", url: "https://meet.google.com/x" } as CalendarEvent["meeting"] });

  it("soon: counts down and offers Join in the card and in its row", async () => {
    await show({ upcoming: [call(new Date(2026, 10, 11, 12, 10), new Date(2026, 10, 11, 12, 30))] });
    const countdown = document.querySelector("[class*=countdownLine]") as HTMLElement;
    expect(countdown.textContent).toBe("Standup in 10 min");
    const card = screen.getByRole("button", { name: "Join" });
    expect(card.title).toBe("Join with Google Meet");
    const joins = [card, screen.getByRole("button", { name: "Join with Google Meet" })];
    expect(screen.getByRole("button", { name: /Standup/ }).className).toContain("withJoin");
    for (const join of joins) fireEvent.click(join);
    expect(mocks.openExternal).toHaveBeenCalledTimes(2);
    expect(mocks.openExternal).toHaveBeenCalledWith("https://meet.google.com/x");
  });

  it("later in the day: counted down, nothing to join yet", async () => {
    await show({ upcoming: [call(new Date(2026, 10, 11, 15), new Date(2026, 10, 11, 16))] });
    expect((document.querySelector("[class*=countdownLine]") as HTMLElement).textContent).toBe("Standup in 3 h");
    expect(screen.queryByRole("button", { name: /Join/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Standup/ }).className).not.toContain("withJoin");
  });

  it("nothing timed ahead: no countdown", async () => {
    const { container } = await show({
      upcoming: [timed("a", "Holiday", new Date(2026, 10, 12), new Date(2026, 10, 13), { allDay: true })],
    });
    expect(container.querySelector("[class*=countdown]")).toBeNull();
  });
});

describe("refreshing", () => {
  it("every five minutes, on a change from another window, on sign-in, on a calendar shown or hidden", async () => {
    const { loads } = await show();
    const count = () => loads.upcoming.mock.calls.length;
    let n = count();
    act(() => void vi.advanceTimersByTime(5 * 60_000));
    await flush();
    expect(count()).toBe(++n);
    act(() => mocks.listeners.get("events-changed")?.());
    await flush();
    expect(count()).toBe(++n);
    act(() => mocks.listeners.get("auth-changed")?.());
    await flush();
    expect(count()).toBe(++n);
    act(() => void window.dispatchEvent(new StorageEvent("storage", { key: "calm.calendarVisibility" })));
    await flush();
    expect(count()).toBe(++n);
    act(() => void window.dispatchEvent(new StorageEvent("storage", { key: "calm.theme" })));
    await flush();
    expect(count()).toBe(n);
  });

  it("once closed it stops listening and refreshing", async () => {
    const { loads } = await show();
    cleanup();
    const n = loads.upcoming.mock.calls.length;
    act(() => void vi.advanceTimersByTime(10 * 60_000));
    window.dispatchEvent(new StorageEvent("storage", { key: "calm.calendarVisibility" }));
    await flush();
    expect(loads.upcoming.mock.calls.length).toBe(n);
    expect(mocks.listeners.size).toBe(0);
  });
});

describe("quick add in the widget", () => {
  it("creates in a writable calendar, refreshes and tells the other windows", async () => {
    const { loads } = await show({ calendars: [CALENDARS.find((c) => c.id === SHARED) as Calendar, CALENDARS[0]] });
    const line = screen.getByRole("textbox", { name: "Quick add an event" });
    expect(line.getAttribute("placeholder")).toBe("+ New event");
    const n = loads.upcoming.mock.calls.length;
    fireEvent.change(line, { target: { value: "tomorrow 7pm gym" } });
    fireEvent.keyDown(line, { key: "Enter" });
    await flush();
    expect(mocks.saveEvent).toHaveBeenCalledWith(expect.objectContaining({ calendarId: MINE, title: "Gym" }));
    expect(loads.upcoming.mock.calls.length).toBe(n + 1);
    expect(mocks.broadcast).toHaveBeenCalledWith("events-changed", { from: "widget" });
  });

  it("Ctrl+Enter opens the calendar on that day with the form", async () => {
    await show();
    const line = screen.getByRole("textbox", { name: "Quick add an event" });
    fireEvent.change(line, { target: { value: "tomorrow 7pm gym" } });
    fireEvent.keyDown(line, { key: "Enter", ctrlKey: true });
    expect(mocks.openMain).toHaveBeenCalledWith("2026-11-12");
    expect(mocks.broadcast).toHaveBeenCalledWith("open-draft", expect.objectContaining({ title: "Gym" }));
  });
});

describe("the widget window", () => {
  it("offline: says since when", async () => {
    const { container } = await show({ offlineSince: new Date(2026, 10, 11, 11).getTime() });
    expect(container.querySelector("[class*=offline]")?.textContent).toMatch(/^Offline/);
    cleanup();
    const online = await show();
    expect(online.container.querySelector("[class*=offline]")).toBeNull();
  });

  it("in the app the window drags by the card but not by its buttons or the line, and only by the left button", async () => {
    mocks.tauri = true;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    const { container } = await show();
    const card = container.firstElementChild as HTMLElement;
    fireEvent.mouseDown(card, { button: 2 });
    fireEvent.mouseDown(screen.getByRole("button", { name: "Next month" }), { button: 0 });
    fireEvent.mouseDown(screen.getByRole("textbox", { name: "Quick add an event" }), { button: 0 });
    await flush();
    expect(mocks.startDragging).not.toHaveBeenCalled();
    fireEvent.mouseDown(card.querySelector("[class*=date]") as HTMLElement, { button: 0 });
    await flush();
    expect(mocks.startDragging).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("in a browser the card doesn't drag or resize anything", async () => {
    const { container } = await show();
    fireEvent.mouseDown(container.firstElementChild as HTMLElement, { button: 0 });
    await flush();
    expect(mocks.startDragging).not.toHaveBeenCalled();
    expect(mocks.setSize).not.toHaveBeenCalled();
  });

  it("in the app the window takes the card's height whenever it changes", async () => {
    mocks.tauri = true;
    let changed = () => {};
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          changed = callback;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 412.2 });
    const { container } = await show();
    expect(observe).toHaveBeenCalledWith(container.firstElementChild);
    changed();
    await flush();
    expect(mocks.setSize).toHaveBeenCalledWith(expect.objectContaining({ width: 300, height: 413 }));
    cleanup();
    expect(disconnect).toHaveBeenCalled();
    delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
    vi.unstubAllGlobals();
  });

  it("a month already paged away isn't reset by a refresh", async () => {
    const { scope } = await show();
    await act(() => allSettled(monthShifted, { scope, params: 1 }));
    act(() => mocks.listeners.get("events-changed")?.());
    await flush();
    expect(screen.getByRole("button", { name: "December 2026" })).toBeTruthy();
  });
});

describe("upcoming edges", () => {
  it("an event from midnight today keeps its time; one ending right now is gone", async () => {
    await show({
      upcoming: [
        timed("a", "Night shift", new Date(2026, 10, 11, 0, 0), new Date(2026, 10, 11, 23, 0)),
        timed("b", "Ended", new Date(2026, 10, 11, 11, 0), NOW),
      ],
    });
    const rows = within(screen.getByRole("list")).getAllByRole("listitem").map((li) => li.textContent);
    expect(rows).toEqual([`Today ${formatTime(new Date(2026, 10, 11, 0, 0))}Night shift`]);
  });

  it("at the same start the all-day event comes first", async () => {
    await show({
      upcoming: [
        timed("t", "Early", new Date(2026, 10, 12, 0, 0), new Date(2026, 10, 12, 1, 0)),
        timed("d", "Holiday", new Date(2026, 10, 12), new Date(2026, 10, 13), { allDay: true }),
      ],
    });
    const rows = within(screen.getByRole("list")).getAllByRole("listitem").map((li) => li.textContent);
    expect(rows[0]).toBe("TomorrowHoliday");
  });

  it("quick add uses a calendar shared for writing too", async () => {
    const writer = { ...CALENDARS[0], id: "writer-calendar", accessRole: "writer" as const };
    await show({ calendars: [CALENDARS.find((c) => c.id === SHARED) as Calendar, writer] });
    const line = screen.getByRole("textbox", { name: "Quick add an event" });
    fireEvent.change(line, { target: { value: "tomorrow 7pm gym" } });
    fireEvent.keyDown(line, { key: "Enter" });
    await flush();
    expect(mocks.saveEvent).toHaveBeenCalledWith(expect.objectContaining({ calendarId: "writer-calendar" }));
  });
});
