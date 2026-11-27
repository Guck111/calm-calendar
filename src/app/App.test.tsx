// @vitest-environment jsdom
// The main window: what it shows for each sign-in state, and its timers, bus messages and hotkeys
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { allSettled, createWatch, fork, type Scope, type Unit } from "effector";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appStarted, fetchStatusFx, statusRetryClicked } from "../model/auth";
import { fetchCalendarsFx } from "../model/calendars";
import { connectionChanged, offlineText } from "../model/connection";
import { draftOpened } from "../model/editor";
import { actionFailed, refreshRequested, reloadRequested } from "../model/events";
import { quickFocusRequested } from "../model/quick";
import { retryClicked } from "../model/sync";
import { dayOpened, minuteTicked, nextClicked, prevClicked, todayClicked, viewChanged } from "../model/view";
import type { EventDraft } from "../shared/api/types";
import { setLang } from "../shared/i18n";
import type { ViewMode } from "../shared/lib/date";
import { CALENDARS, appScope, renderIn } from "../ui/app-scope.test-utils";
import { App } from "./App";

vi.hoisted(() => {
  window.matchMedia ??= ((media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} })) as never;
});

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (payload: unknown) => void>(),
  displayReloaded: vi.fn(),
  secondZoneReloaded: vi.fn(),
}));
vi.mock("../shared/api/bus", async (real) => ({
  ...(await real<object>()),
  get inTauri() {
    return true;
  },
  subscribe: (name: string, handler: (payload: unknown) => void) => {
    mocks.listeners.set(name, handler);
    return () => mocks.listeners.delete(name);
  },
}));
vi.mock("../model/display", async (real) => ({ ...(await real<object>()), displayReloaded: mocks.displayReloaded }));
vi.mock("../model/zones", async (real) => ({ ...(await real<object>()), secondZoneReloaded: mocks.secondZoneReloaded }));

// the parts of the window have tests of their own: here they only show where they are
vi.mock("../ui/AuthScreen", () => ({ AuthScreen: () => "AuthScreen" }));
vi.mock("../ui/Sidebar", () => ({ Sidebar: () => "Sidebar" }));
vi.mock("../ui/Toolbar", () => ({ Toolbar: () => "Toolbar" }));
vi.mock("../ui/TimeGrid", () => ({ TimeGrid: () => "TimeGrid" }));
vi.mock("../ui/MonthView", () => ({ MonthView: () => "MonthView" }));
vi.mock("../ui/ScheduleView", () => ({ ScheduleView: () => "ScheduleView" }));
vi.mock("../ui/EventEditor", () => ({ EventEditor: () => "EventEditor" }));
vi.mock("../ui/UndoToast", () => ({ UndoToast: () => "UndoToast" }));
vi.mock("../ui/Welcome", () => ({ Welcome: () => "Welcome" }));
vi.mock("../ui/RateCard", () => ({ RateCard: () => "RateCard" }));
vi.mock("../ui/CommandMenu", () => ({ CommandMenu: () => "CommandMenu" }));
vi.mock("../ui/Shortcuts", () => ({ Shortcuts: () => "Shortcuts" }));

const PARTS = ["Sidebar", "Toolbar", "EventEditor", "UndoToast", "Welcome", "RateCard", "CommandMenu", "Shortcuts"];

beforeEach(() => {
  setLang("en");
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mocks.listeners.clear();
  document.body.innerHTML = "";
  setLang("ru");
});

/** every call of the given events, in order */
const watch = (scope: Scope, events: Record<string, Unit<unknown>>) => {
  const calls: [string, unknown][] = [];
  for (const [name, unit] of Object.entries(events)) createWatch({ unit, scope, fn: (p) => calls.push([name, p]) });
  return calls;
};

const signedInApp = async ({ view = "week" as ViewMode } = {}) => {
  const scope = await appScope();
  await allSettled(viewChanged, { scope, params: view });
  return scope;
};

const show = (scope: Scope) => renderIn(scope, <App />);

const signedOut = () =>
  fork({
    handlers: [
      [fetchStatusFx, async () => ({ clientSource: "build", accounts: [] })],
      [fetchCalendarsFx, async () => ({ calendars: CALENDARS, failed: [], lost: [] })],
    ] as never,
  });

const send = (name: string, payload?: unknown) => act(() => mocks.listeners.get(name)!(payload));

const press = (key: string, init: KeyboardEventInit = {}, target: Element = document.body) =>
  fireEvent.keyDown(target, { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, ...init });

describe("what the window shows", () => {
  it("a blank splash while the sign-in status is on its way", async () => {
    const scope = fork({ handlers: [[fetchStatusFx, () => new Promise(() => {})]] as never });
    const calls = watch(scope, { appStarted });
    const { container } = show(scope);
    expect(calls).toEqual([["appStarted", undefined]]);
    expect(container.textContent).toBe("");
    expect(container.firstElementChild).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says when the status could not be read and asks again on Retry", async () => {
    let fails = true;
    const scope = fork({
      handlers: [
        [
          fetchStatusFx,
          async () => {
            if (fails) throw new Error("keyring locked");
            return { clientSource: "build", accounts: [] };
          },
        ],
      ] as never,
    });
    const calls = watch(scope, { statusRetryClicked });
    show(scope);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Something went wrong");
    expect(alert.textContent).toContain("keyring locked");

    fails = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(calls).toEqual([["statusRetryClicked", undefined]]);
    expect(await screen.findByText("AuthScreen")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("the sign-in screen when no account is signed in", async () => {
    const scope = signedOut();
    await allSettled(fetchStatusFx, { scope });
    show(scope);
    expect(screen.getByText("AuthScreen")).toBeTruthy();
    expect(screen.queryByText("Sidebar")).toBeNull();
  });

  it("the calendar with all its parts once signed in", async () => {
    const { container } = show(await signedInApp());
    for (const part of PARTS) expect(container.textContent).toContain(part);
    expect(container.querySelector("main")!.textContent).toBe("ToolbarTimeGrid");
    expect(screen.queryByText("AuthScreen")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it.each([
    ["day", "TimeGrid"],
    ["week", "TimeGrid"],
    ["month", "MonthView"],
    ["agenda", "ScheduleView"],
  ] as const)("the %s view is drawn by %s", async (view, part) => {
    const { container } = show(await signedInApp({ view }));
    expect(container.querySelector("main")!.textContent).toBe(`Toolbar${part}`);
  });
});

describe("the bar above the calendar", () => {
  it("shows a load error with Retry, which waits while loading", async () => {
    let held: Promise<void> | undefined;
    let release = () => {};
    const loadCalendars = async () => {
      await held;
      return { calendars: CALENDARS, failed: [], lost: [] };
    };
    const scope = await appScope({ handlers: [[fetchCalendarsFx, loadCalendars]] });
    const calls = watch(scope, { retryClicked });
    show(scope);
    await act(() => allSettled(actionFailed, { scope, params: "Could not save" }));
    expect(screen.getByRole("status").textContent).toBe("Could not saveRetry");

    held = new Promise<void>((done) => (release = done));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(calls).toEqual([["retryClicked", undefined]]);
    const retrying = screen.getByRole("button", { name: "Trying again…" }) as HTMLButtonElement;
    expect(retrying.disabled).toBe(true);

    await act(async () => {
      release();
      await allSettled(scope);
    });
    expect((screen.getByRole("button", { name: "Retry" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("says the calendar is offline when no error covers it", async () => {
    const scope = await signedInApp();
    show(scope);
    const since = new Date(2026, 10, 11, 9, 5).getTime();
    await act(() => allSettled(connectionChanged, { scope, params: since }));
    expect(screen.getByRole("status").textContent).toBe(`${offlineText(since)}Retry`);

    await act(() => allSettled(actionFailed, { scope, params: "Could not save" }));
    expect(screen.getByRole("status").textContent).toBe("Could not saveRetry");
  });
});

describe("messages from other windows", () => {
  it("opens the day from the address", async () => {
    window.history.replaceState(null, "", "/?date=2026-11-20");
    const scope = await signedInApp();
    const calls = watch(scope, { dayOpened });
    show(scope);
    expect(calls).toEqual([["dayOpened", new Date(2026, 10, 20)]]);
  });

  it("opens nothing without a date in the address", async () => {
    window.history.replaceState(null, "", "/?window=main");
    const scope = await signedInApp();
    const calls = watch(scope, { dayOpened });
    show(scope);
    expect(calls).toEqual([]);
  });

  it("opens a day, or a draft on its day, sent by the widget", async () => {
    const scope = await signedInApp();
    const calls = watch(scope, { dayOpened, draftOpened });
    show(scope);
    send("open-date", { date: "2026-11-18" });
    const draft = { title: "Lunch", startDate: "2026-11-19" } as EventDraft;
    send("open-draft", draft);
    expect(calls).toEqual([
      ["dayOpened", new Date(2026, 10, 18)],
      ["dayOpened", new Date(2026, 10, 19)],
      ["draftOpened", draft],
    ]);
  });

  it("reloads events changed elsewhere, but not its own changes", async () => {
    const scope = await signedInApp();
    const calls = watch(scope, { reloadRequested });
    show(scope);
    send("events-changed", { from: "main" });
    expect(calls).toEqual([]);
    send("events-changed", { from: "widget" });
    send("events-changed");
    expect(calls).toEqual([
      ["reloadRequested", undefined],
      ["reloadRequested", undefined],
    ]);
  });

  it("rereads the display settings changed in the settings window", async () => {
    show(await signedInApp());
    send("display-changed");
    expect(mocks.secondZoneReloaded).toHaveBeenCalledOnce();
    expect(mocks.displayReloaded).toHaveBeenCalledOnce();
  });

  it("stops listening when closed", async () => {
    const { unmount } = show(await signedInApp());
    expect([...mocks.listeners.keys()].sort()).toEqual(["display-changed", "events-changed", "open-date", "open-draft"]);
    unmount();
    expect(mocks.listeners.size).toBe(0);
  });
});

describe("timers", () => {
  const fakeTime = (at: Date) => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    vi.setSystemTime(at);
  };

  it("ticks at each minute boundary", async () => {
    const scope = await signedInApp();
    const calls = watch(scope, { minuteTicked });
    fakeTime(new Date(2026, 10, 11, 12, 0, 40));
    const { unmount } = show(scope);
    act(() => vi.advanceTimersByTime(19_999));
    expect(calls).toEqual([]);
    act(() => vi.advanceTimersByTime(1));
    expect(calls).toEqual([["minuteTicked", new Date(2026, 10, 11, 12, 1)]]);
    act(() => vi.advanceTimersByTime(60_000));
    expect(calls.at(-1)).toEqual(["minuteTicked", new Date(2026, 10, 11, 12, 2)]);
    unmount();
    act(() => vi.advanceTimersByTime(120_000));
    expect(calls).toHaveLength(2);
  });

  it("does not tick after closing before the first minute", async () => {
    const scope = await signedInApp();
    const calls = watch(scope, { minuteTicked });
    fakeTime(new Date(2026, 10, 11, 12, 0, 40));
    show(scope).unmount();
    act(() => vi.advanceTimersByTime(120_000));
    expect(calls).toEqual([]);
  });

  it("refreshes every five minutes and on coming back after half a minute", async () => {
    const scope = await signedInApp();
    const calls = watch(scope, { refreshRequested });
    fakeTime(new Date(2026, 10, 11, 12));
    const { unmount } = show(scope);
    const visibility = vi.spyOn(Document.prototype, "visibilityState", "get");

    act(() => void window.dispatchEvent(new Event("focus")));
    act(() => vi.advanceTimersByTime(29_999));
    act(() => void window.dispatchEvent(new Event("focus")));
    expect(calls).toEqual([]);
    act(() => vi.advanceTimersByTime(1));
    act(() => void window.dispatchEvent(new Event("focus")));
    expect(calls).toHaveLength(1);

    act(() => vi.advanceTimersByTime(30_000));
    visibility.mockReturnValue("hidden");
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(calls).toHaveLength(1);
    visibility.mockReturnValue("visible");
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(calls).toHaveLength(2);

    act(() => vi.advanceTimersByTime(5 * 60_000 - 60_000 - 1));
    expect(calls).toHaveLength(2);
    act(() => vi.advanceTimersByTime(1));
    expect(calls).toHaveLength(3);
    // the timed refresh counts too: coming back right after it does not repeat it
    act(() => void window.dispatchEvent(new Event("focus")));
    expect(calls).toHaveLength(3);

    unmount();
    act(() => vi.advanceTimersByTime(10 * 60_000));
    act(() => void window.dispatchEvent(new Event("focus")));
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(calls).toHaveLength(3);
  });

  it("does not refresh while signed out", async () => {
    const scope = signedOut();
    await allSettled(fetchStatusFx, { scope });
    const calls = watch(scope, { refreshRequested });
    fakeTime(new Date(2026, 10, 11, 12));
    show(scope);
    act(() => vi.advanceTimersByTime(10 * 60_000));
    act(() => void window.dispatchEvent(new Event("focus")));
    expect(calls).toEqual([]);
  });
});

describe("hotkeys", () => {
  const keys = { prevClicked, nextClicked, todayClicked, viewChanged, quickFocusRequested };

  it("page, jump to today, switch the view and add an event", async () => {
    const scope = await signedInApp();
    const calls = watch(scope, keys);
    show(scope);
    for (const key of ["ArrowLeft", "ArrowRight", "t", "d", "w", "m", "a", "n"]) expect(press(key)).toBe(false);
    expect(calls).toEqual([
      ["prevClicked", undefined],
      ["nextClicked", undefined],
      ["todayClicked", undefined],
      ["viewChanged", "day"],
      ["viewChanged", "week"],
      ["viewChanged", "month"],
      ["viewChanged", "agenda"],
      ["quickFocusRequested", undefined],
    ]);
  });

  it("go by the key's place, so they work in any keyboard layout", async () => {
    const scope = await signedInApp();
    const calls = watch(scope, keys);
    show(scope);
    press("е", { code: "KeyT" });
    press("t", { code: "KeyY" });
    expect(calls).toEqual([["todayClicked", undefined]]);
  });

  it("swap the arrows in right-to-left", async () => {
    setLang("ar");
    const scope = await signedInApp();
    const calls = watch(scope, keys);
    show(scope);
    press("ArrowLeft");
    press("ArrowRight");
    expect(calls).toEqual([
      ["nextClicked", undefined],
      ["prevClicked", undefined],
    ]);
  });

  it("leave other keys and combinations alone", async () => {
    const scope = await signedInApp();
    const calls = watch(scope, keys);
    show(scope);
    expect(press("x")).toBe(true);
    expect(press("ArrowUp")).toBe(true);
    for (const modifier of ["ctrlKey", "metaKey", "altKey"]) expect(press("t", { [modifier]: true })).toBe(true);
    expect(calls).toEqual([]);
  });

  it("leave typing alone", async () => {
    const scope = await signedInApp();
    const calls = watch(scope, keys);
    show(scope);
    const fields = ["input", "textarea", "select"].map((tag) => document.createElement(tag));
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    Object.defineProperty(editable, "isContentEditable", { value: true });
    for (const field of [...fields, editable]) {
      document.body.append(field);
      press("t", {}, field);
      press("ArrowLeft", {}, field);
    }
    const button = document.createElement("button");
    document.body.append(button);
    press("t", {}, button);
    expect(calls).toEqual([["todayClicked", undefined]]);
  });

  it("leave the arrows to a selected event, but not the letters", async () => {
    const scope = await signedInApp();
    const calls = watch(scope, keys);
    show(scope);
    const block = document.createElement("button");
    block.dataset.eventKey = "k1";
    document.querySelector("main")!.append(block);
    press("ArrowLeft", {}, block);
    press("ArrowRight", {}, block);
    press("t", {}, block);
    expect(calls).toEqual([["todayClicked", undefined]]);
  });

  it("are off while the editor is open", async () => {
    const scope = await signedInApp();
    const calls = watch(scope, keys);
    show(scope);
    await act(() => allSettled(draftOpened, { scope, params: { title: "", startDate: "2026-11-11" } as EventDraft }));
    press("t");
    press("ArrowLeft");
    expect(calls).toEqual([]);
  });

  it("are off while signed out and after closing", async () => {
    const scope = signedOut();
    await allSettled(fetchStatusFx, { scope });
    const calls = watch(scope, keys);
    show(scope);
    press("t");
    cleanup();
    const signedIn = await signedInApp();
    const later = watch(signedIn, keys);
    show(signedIn).unmount();
    press("t");
    expect([...calls, ...later]).toEqual([]);
  });
});

