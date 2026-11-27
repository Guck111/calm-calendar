// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { allSettled, fork, type Scope } from "effector";
import { Provider } from "effector-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthStatus, CalendarEvent } from "../shared/api/types";
import { setLang } from "../shared/i18n";
import { formatTime } from "../shared/lib/date";
import { CALENDARS, ME, event } from "../ui/app-scope.test-utils";
import { $now, $today, fetchCalendarsFx, fetchMonthFx, fetchStatusFx, fetchUpcomingFx, widgetStarted } from "../widget/model";
import { AgendaWindow } from "./AgendaWindow";

const mocks = vi.hoisted(() => ({
  tauri: true,
  openMain: vi.fn((_date?: string) => {}),
  invoke: vi.fn(async (_cmd: string) => undefined),
  listeners: new Map<string, () => void>(),
  openExternal: vi.fn(async (_url: string) => {}),
}));
vi.mock("../shared/api/bus", async (real) => ({
  ...(await real<object>()),
  get inTauri() {
    return mocks.tauri;
  },
  openMain: mocks.openMain,
  subscribe: (name: string, handler: () => void) => {
    mocks.listeners.set(name, handler);
    return () => mocks.listeners.delete(name);
  },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../shared/api/open", () => ({ openExternal: mocks.openExternal }));

// Wednesday, November 11, 2026, 12:00
const NOW = new Date(2026, 10, 11, 12, 0);
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m);
const signedIn: AuthStatus = { clientSource: "build", accounts: [{ email: ME, signedIn: true }] };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(NOW);
  setLang("en");
  mocks.tauri = true;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  mocks.listeners.clear();
  setLang("ru");
});

const flush = () => act(async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
});

const show = async ({ status = signedIn, upcoming = [] as CalendarEvent[], pending = false, now = NOW } = {}) => {
  const loads = vi.fn();
  const scope: Scope = fork({
    values: [[$now, now], [$today, at(11, 0)]] as never,
    handlers: [
      [fetchStatusFx, async () => status],
      [fetchCalendarsFx, async () => CALENDARS],
      [fetchUpcomingFx, () => (loads(), pending ? new Promise(() => {}) : Promise.resolve(upcoming))],
      [fetchMonthFx, async ({ month }: { month: Date }) => ({ month, events: [] })],
    ] as never,
  });
  if (!pending) await allSettled(widgetStarted, { scope });
  render(
    <Provider value={scope}>
      <AgendaWindow />
    </Provider>,
  );
  await flush();
  return { scope, loads };
};

const headings = () => screen.queryAllByRole("heading").map((h) => h.textContent);

describe("tray agenda", () => {
  it("before the status is known: only the way to the calendar", async () => {
    const scope = fork({ handlers: [[fetchStatusFx, () => new Promise(() => {})]] as never });
    render(
      <Provider value={scope}>
        <AgendaWindow />
      </Provider>,
    );
    await flush();
    expect(headings()).toEqual([]);
    expect(screen.queryByText("Sign in to Google in the calendar window")).toBeNull();
    expect(screen.getByRole("button", { name: "Open calendar" })).toBeTruthy();
  });

  it("signed out: a hint", async () => {
    await show({ status: { clientSource: "build", accounts: [] } });
    expect(screen.getByText("Sign in to Google in the calendar window")).toBeTruthy();
    expect(headings()).toEqual([]);
  });

  it("today and tomorrow with their dates; an empty day says so", async () => {
    await show();
    expect(headings()).toEqual(["TodayWed, November 11", "TomorrowThu, November 12"]);
    expect(screen.getAllByText("Nothing planned")).toHaveLength(2);
  });

  it("while loading the days say so", async () => {
    await show({ pending: true });
    expect(screen.getAllByText("Loading…")).toHaveLength(2);
  });

  it("each event with its time, all day for the whole day; ended ones dimmed, the current one marked", async () => {
    await show({
      upcoming: [
        event({ key: "a", id: "a", title: "Standup", start: at(11, 9), end: at(11, 9, 30) }),
        event({ key: "b", id: "b", title: "Lunch", start: at(11, 11, 30), end: at(11, 12, 30), colorId: "11" }),
        event({ key: "c", id: "c", title: "Trip", start: at(10, 18), end: at(12, 9) }),
        event({ key: "d", id: "d", title: "Holiday", allDay: true, start: at(12, 0), end: at(13, 0) }),
      ],
    });
    const rows = screen.getAllByRole("listitem");
    const text = rows.map((r) => r.textContent);
    expect(text).toContain(`${formatTime(at(11, 9))}–${formatTime(at(11, 9, 30))}Standup`);
    expect(text).toContain("All dayHoliday");
    // a trip from yesterday evening to tomorrow morning: all of today, tomorrow until it ends
    expect(text.filter((t) => t === "All dayTrip")).toHaveLength(1);
    expect(text).toContain(`${formatTime(at(10, 18))}–${formatTime(at(12, 9))}Trip`);
    const row = (title: string) => rows.find((r) => r.textContent?.endsWith(title)) as HTMLElement;
    expect(row("Standup").className).toContain("past");
    expect(row("Lunch").className).toContain("now");
    expect(row("Lunch").className).not.toContain("past");
    expect(row("Lunch").style.getPropertyValue("--c")).toMatch(/^#/);
    expect(row("Holiday").style.getPropertyValue("--c")).toBe("#4285f4");
  });

  it("an event opens its day in the calendar and hides the agenda; so does the footer", async () => {
    await show({ upcoming: [event({ key: "d", id: "d", title: "Holiday", allDay: true, start: at(12, 0), end: at(13, 0) })] });
    fireEvent.click(screen.getByRole("button", { name: /Holiday/ }));
    expect(mocks.openMain).toHaveBeenLastCalledWith("2026-11-12");
    expect(mocks.invoke).toHaveBeenCalledWith("hide_agenda");
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    expect(mocks.openMain).toHaveBeenLastCalledWith(undefined);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("a call that starts soon has Join", async () => {
    const meeting = { provider: "Zoom", url: "https://zoom.us/j/1" } as CalendarEvent["meeting"];
    await show({
      upcoming: [
        event({ key: "a", id: "a", title: "Soon", start: at(11, 12, 10), end: at(11, 13), meeting }),
        event({ key: "b", id: "b", title: "Later", start: at(11, 16), end: at(11, 17), meeting }),
      ],
    });
    const join = screen.getByRole("button", { name: "Join" });
    expect(join.title).toBe("Join with Zoom");
    fireEvent.click(join);
    expect(mocks.openExternal).toHaveBeenCalledWith("https://zoom.us/j/1");
  });

  it("Esc hides it; in a browser there is nothing to hide", async () => {
    await show();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(mocks.invoke).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(mocks.invoke).toHaveBeenCalledWith("hide_agenda");
    cleanup();
    vi.clearAllMocks();
    mocks.tauri = false;
    await show();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("each show refreshes it and moves the clock; a change in another window refreshes it", async () => {
    const { loads } = await show();
    const n = loads.mock.calls.length;
    vi.setSystemTime(at(11, 13));
    await act(async () => mocks.listeners.get("agenda-shown")?.());
    await flush();
    expect(loads.mock.calls.length).toBe(n + 1);
    await act(async () => mocks.listeners.get("events-changed")?.());
    await flush();
    expect(loads.mock.calls.length).toBe(n + 2);
  });

  it("the clock moves every half minute, so a meeting turns current", async () => {
    vi.setSystemTime(at(11, 11, 59));
    await show({ now: at(11, 11, 59), upcoming: [event({ key: "b", id: "b", title: "Next", start: at(11, 12, 0), end: at(11, 13) })] });
    const row = () => screen.getAllByRole("listitem").find((r) => r.textContent?.endsWith("Next")) as HTMLElement;
    expect(row().className).not.toContain("now");
    act(() => void vi.advanceTimersByTime(29_000));
    expect(row().className).not.toContain("now");
    vi.setSystemTime(at(11, 12, 0));
    act(() => void vi.advanceTimersByTime(1_000));
    expect(row().className).toContain("now");
  });

  it("once closed it stops listening and ticking", async () => {
    await show();
    cleanup();
    expect(mocks.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});

describe("what counts as all day", () => {
  it("a timed event covering exactly the whole day, or more, is all day; a shorter one shows its time", async () => {
    await show({
      upcoming: [
        event({ key: "a", id: "a", title: "Exact", start: at(12, 0), end: at(13, 0) }),
        event({ key: "b", id: "b", title: "Short", start: at(12, 0), end: at(12, 23, 59) }),
        event({ key: "c", id: "c", title: "Late", start: at(12, 0, 1), end: at(13, 1) }),
      ],
    });
    const text = screen.getAllByRole("listitem").map((r) => r.textContent);
    expect(text).toContain("All dayExact");
    expect(text).toContain(`${formatTime(at(12, 0))}–${formatTime(at(12, 23, 59))}Short`);
    expect(text).toContain(`${formatTime(at(12, 0, 1))}–${formatTime(at(13, 1))}Late`);
  });

  it("each show moves the clock even without new events", async () => {
    await show({ upcoming: [event({ key: "a", id: "a", title: "Call", start: at(11, 12, 30), end: at(11, 13) })] });
    const row = () => screen.getAllByRole("listitem").find((r) => r.textContent?.endsWith("Call")) as HTMLElement;
    expect(row().className).not.toContain("now");
    vi.setSystemTime(at(11, 12, 40));
    await act(async () => mocks.listeners.get("agenda-shown")?.());
    expect(row().className).toContain("now");
  });
});
