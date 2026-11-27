// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { fork, type Scope } from "effector";
import { Provider } from "effector-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthStatus, Calendar } from "../shared/api/types";
import { setLang } from "../shared/i18n";
import { CALENDARS, ME, MINE, SHARED } from "../ui/app-scope.test-utils";
import { fetchCalendarsFx, fetchMonthFx, fetchStatusFx, fetchUpcomingFx } from "../widget/model";
import { QuickWindow } from "./QuickWindow";

const mocks = vi.hoisted(() => ({
  tauri: true,
  openMain: vi.fn((_date?: string) => {}),
  broadcast: vi.fn((_name: string, _payload?: unknown) => {}),
  invoke: vi.fn(async (_cmd: string) => undefined),
  saveEvent: vi.fn(async (_draft: object) => {}),
  listeners: new Map<string, () => void>(),
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
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../shared/api/calendar", async (real) => ({ ...(await real<object>()), saveEvent: mocks.saveEvent }));

const signedIn: AuthStatus = { clientSource: "build", accounts: [{ email: ME, signedIn: true }] };

// Wednesday, November 11, 2026, 12:00
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 11, 12));
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

const show = async ({
  status = signedIn as AuthStatus | "pending",
  calendars = CALENDARS as Calendar[] | "pending" | "failed",
} = {}) => {
  const loads = vi.fn();
  const scope: Scope = fork({
    handlers: [
      [fetchStatusFx, () => (status === "pending" ? new Promise(() => {}) : Promise.resolve(status))],
      [
        fetchCalendarsFx,
        () => {
          loads();
          if (calendars === "pending") return new Promise(() => {});
          if (calendars === "failed") return Promise.reject({ kind: "network", message: "offline" });
          return Promise.resolve(calendars);
        },
      ],
      [fetchUpcomingFx, async () => []],
      [fetchMonthFx, async ({ month }: { month: Date }) => ({ month, events: [] })],
    ] as never,
  });
  render(
    <Provider value={scope}>
      <QuickWindow />
    </Provider>,
  );
  await flush();
  return { scope, loads };
};

const line = () => screen.getByRole("textbox", { name: "Quick add an event" }) as HTMLInputElement;

describe("quick add window", () => {
  it("before the status is known: nothing", async () => {
    const view = await show({ status: "pending" });
    expect(view).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText(/Sign in|Loading/)).toBeNull();
  });

  it("signed out: a hint", async () => {
    await show({ status: { clientSource: "build", accounts: [] } });
    expect(screen.getByText("Sign in to Google in the calendar window")).toBeTruthy();
  });

  it("while the calendars load it waits instead of saying there is no calendar", async () => {
    await show({ calendars: "pending" });
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("calendars that failed to load still let the line open: it will name the problem itself", async () => {
    await show({ calendars: "failed" });
    expect(line()).toBeTruthy();
  });

  it("the line is ready with the cursor in it", async () => {
    await show();
    expect(document.activeElement).toBe(line());
    expect(line().placeholder).toBe("+ New event");
    expect(line().parentElement?.className).toContain("popup");
  });

  it("Enter creates in a writable calendar, tells the calendar window and hides", async () => {
    await show({ calendars: [CALENDARS.find((c) => c.id === SHARED) as Calendar, ...CALENDARS] });
    fireEvent.change(line(), { target: { value: "tomorrow 7pm gym" } });
    fireEvent.keyDown(line(), { key: "Enter" });
    await flush();
    expect(mocks.saveEvent).toHaveBeenCalledWith(expect.objectContaining({ calendarId: MINE, title: "Gym" }));
    expect(mocks.broadcast).toHaveBeenCalledWith("events-changed", { from: "quick" });
    expect(mocks.invoke).toHaveBeenCalledWith("hide_quick");
  });

  it("Ctrl+Enter opens the calendar on that day with the form and hides", async () => {
    await show();
    fireEvent.change(line(), { target: { value: "tomorrow 7pm gym" } });
    fireEvent.keyDown(line(), { key: "Enter", ctrlKey: true });
    expect(mocks.openMain).toHaveBeenCalledWith("2026-11-12");
    expect(mocks.broadcast).toHaveBeenCalledWith("open-draft", expect.objectContaining({ title: "Gym" }));
    expect(mocks.invoke).toHaveBeenCalledWith("hide_quick");
  });

  it("each show reloads the calendars and puts the cursor back", async () => {
    const { loads } = await show();
    const n = loads.mock.calls.length;
    line().blur();
    await act(async () => mocks.listeners.get("quick-shown")?.());
    await flush();
    expect(loads.mock.calls.length).toBe(n + 1);
    expect(document.activeElement).toBe(line());
  });

  it("Esc hides the window; in a browser there is nothing to hide", async () => {
    await show();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(mocks.invoke).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(mocks.invoke).toHaveBeenCalledWith("hide_quick");
    cleanup();
    vi.clearAllMocks();
    mocks.tauri = false;
    await show();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("once closed it stops listening", async () => {
    await show();
    cleanup();
    expect(mocks.listeners.size).toBe(0);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("starts loading the calendars by itself when it opens", async () => {
    const { loads } = await show();
    expect(loads).toHaveBeenCalledTimes(1);
  });
});

describe("calendars of the window", () => {
  it("a calendar shared for writing can take the event", async () => {
    const writer = { ...CALENDARS[0], id: "writer-calendar", accessRole: "writer" as const };
    await show({ calendars: [CALENDARS.find((c) => c.id === SHARED) as Calendar, writer] });
    fireEvent.change(line(), { target: { value: "tomorrow 7pm gym" } });
    fireEvent.keyDown(line(), { key: "Enter" });
    await flush();
    expect(mocks.saveEvent).toHaveBeenCalledWith(expect.objectContaining({ calendarId: "writer-calendar" }));
  });
});
