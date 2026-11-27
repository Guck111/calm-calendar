// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../shared/i18n";
import { formatTime } from "../shared/lib/date";
import { AlertWindow, alertStatus, type AlertItem } from "./AlertWindow";

const mocks = vi.hoisted(() => ({
  tauri: false,
  alerts: [] as AlertItem[],
  invoke: vi.fn(async (_cmd: string, _args?: object): Promise<unknown> => undefined),
  listeners: new Map<string, () => void>(),
  openExternal: vi.fn(async (_url: string) => {}),
  setSize: vi.fn(async (_size: unknown) => {}),
  startDragging: vi.fn(async () => {}),
}));
vi.mock("../shared/api/bus", async (real) => ({
  ...(await real<object>()),
  get inTauri() {
    return mocks.tauri;
  },
  subscribe: (name: string, handler: () => void) => {
    mocks.listeners.set(name, handler);
    return () => mocks.listeners.delete(name);
  },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../shared/api/open", () => ({ openExternal: mocks.openExternal }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setSize: mocks.setSize, startDragging: mocks.startDragging }),
  LogicalSize: class {
    constructor(
      public width: number,
      public height: number,
    ) {}
  },
}));

// Wednesday, November 11, 2026, 15:59
const NOW = new Date(2026, 10, 11, 15, 59).getTime();
const at = (h: number, m: number) => new Date(2026, 10, 11, h, m).getTime();
const call: AlertItem = { key: "c", title: "Standup", start: at(16, 0), end: at(16, 30), url: "https://meet.google.com/x", provider: "Google Meet" };
const lunch: AlertItem = { key: "l", title: "Lunch", start: at(16, 0), end: at(17, 0) };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(NOW);
  setLang("en");
  mocks.tauri = false;
  mocks.invoke.mockImplementation(async (cmd) => (cmd === "get_alerts" ? mocks.alerts : undefined));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  mocks.listeners.clear();
  setLang("ru");
});

const inApp = async (alerts: AlertItem[]) => {
  mocks.tauri = true;
  mocks.alerts = alerts;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const view = render(<AlertWindow />);
  await act(async () => {});
  return view;
};

afterEach(() => vi.unstubAllGlobals());

const titles = () => screen.queryAllByRole("heading").map((h) => h.textContent);
const button = (name: string, i = 0) => screen.getAllByRole("button", { name: new RegExp(name) })[i];

describe("alert status", () => {
  it("counts down to the start, says it is starting for a minute around it, then counts down to the end", () => {
    const a = { start: at(16, 0), end: at(16, 30) };
    expect(alertStatus(a, a.start - 30_001)).toBe("in 1 min");
    expect(alertStatus(a, a.start - 30_000)).toBe("Starting now");
    expect(alertStatus(a, a.start - 60_000 + 1)).toBe("in 1 min");
    expect(alertStatus(a, a.start + 59_999)).toBe("Starting now");
    expect(alertStatus(a, a.start + 60_000)).toBe("now, 29 min left");
    expect(alertStatus(a, a.start - 61 * 60_000)).toBe("in 1 h 1 min");
  });
});

describe("in a browser", () => {
  it("shows a sample meeting; each button takes it away", () => {
    render(<AlertWindow />);
    expect(titles()).toEqual(["Design sync"]);
    expect(screen.getByText("in 1 min")).toBeTruthy();
    fireEvent.click(button("Join"));
    expect(mocks.openExternal).toHaveBeenCalledWith("https://meet.google.com/abc-defg-hij");
    expect(titles()).toEqual([]);
    cleanup();
    render(<AlertWindow />);
    fireEvent.click(button("Snooze 5 min"));
    expect(titles()).toEqual([]);
    cleanup();
    render(<AlertWindow />);
    fireEvent.click(button("Dismiss"));
    expect(titles()).toEqual([]);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("the card doesn't drag or resize anything", () => {
    const { container } = render(<AlertWindow />);
    fireEvent.mouseDown(container.firstElementChild as HTMLElement, { button: 0 });
    expect(mocks.startDragging).not.toHaveBeenCalled();
    expect(mocks.setSize).not.toHaveBeenCalled();
  });
});

describe("in the app", () => {
  it("shows the reminders the app keeps: time, the call service, the buttons", async () => {
    await inApp([call, lunch]);
    expect(mocks.invoke).toHaveBeenCalledWith("get_alerts");
    expect(titles()).toEqual(["Standup", "Lunch"]);
    expect(screen.getByText(`${formatTime(new Date(call.start))}–${formatTime(new Date(call.end))}`, { exact: false })).toBeTruthy();
    expect(screen.getByText("· Google Meet")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Join/ })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Snooze 5 min" })).toHaveLength(2);
  });

  it("the first one's main button has the focus: Join for a call, Dismiss otherwise", async () => {
    await inApp([call, lunch]);
    expect(document.activeElement).toBe(button("Join"));
    cleanup();
    await inApp([lunch, call]);
    expect(document.activeElement).toBe(button("Dismiss", 0));
  });

  it("Join opens the call and dismisses; Snooze asks for five minutes; Dismiss dismisses", async () => {
    await inApp([call, lunch]);
    fireEvent.click(button("Join"));
    expect(mocks.openExternal).toHaveBeenCalledWith(call.url);
    expect(mocks.invoke).toHaveBeenCalledWith("dismiss_alert", { key: "c" });
    fireEvent.click(button("Snooze 5 min", 1));
    expect(mocks.invoke).toHaveBeenCalledWith("snooze_alert", { key: "l", minutes: 5 });
    fireEvent.click(button("Dismiss", 1));
    expect(mocks.invoke).toHaveBeenCalledWith("dismiss_alert", { key: "l" });
  });

  it("Enter joins the first call, or dismisses a reminder without one; Esc dismisses", async () => {
    await inApp([call]);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(mocks.openExternal).toHaveBeenCalledWith(call.url);
    cleanup();
    vi.clearAllMocks();
    await inApp([lunch]);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(mocks.invoke).toHaveBeenCalledWith("dismiss_alert", { key: "l" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(mocks.invoke).toHaveBeenCalledTimes(3);
    fireEvent.keyDown(window, { key: "a" });
    expect(mocks.invoke).toHaveBeenCalledTimes(3);
  });

  it("Enter on a button is that button's, not the first reminder's", async () => {
    await inApp([call]);
    fireEvent.keyDown(button("Snooze 5 min"), { key: "Enter" });
    expect(mocks.openExternal).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("without reminders the keys do nothing", async () => {
    await inApp([]);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("reloads when the app says the reminders changed; the status follows the clock", async () => {
    await inApp([call]);
    expect(screen.getByText("in 1 min")).toBeTruthy();
    mocks.alerts = [lunch];
    await act(async () => mocks.listeners.get("alerts-changed")?.());
    expect(titles()).toEqual(["Lunch"]);
    vi.setSystemTime(at(16, 5));
    act(() => void vi.advanceTimersByTime(15_000));
    expect(screen.getByText("now, 55 min left")).toBeTruthy();
  });

  it("once closed it stops listening and ticking", async () => {
    await inApp([call]);
    cleanup();
    expect(mocks.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("the window drags by the card, not by its buttons, and only with the left button", async () => {
    const { container } = await inApp([call]);
    const card = container.firstElementChild as HTMLElement;
    fireEvent.mouseDown(card, { button: 2 });
    fireEvent.mouseDown(button("Dismiss"), { button: 0 });
    await act(async () => {});
    expect(mocks.startDragging).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByRole("heading"), { button: 0 });
    await act(async () => {});
    expect(mocks.startDragging).toHaveBeenCalledTimes(1);
  });

  it("the window takes the card's height whenever it changes", async () => {
    mocks.tauri = true;
    mocks.alerts = [call];
    let changed = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          changed = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 180.4 });
    render(<AlertWindow />);
    changed();
    await act(async () => {});
    expect(mocks.setSize).toHaveBeenCalledWith(expect.objectContaining({ width: 460, height: 181 }));
    cleanup();
    expect(disconnect).toHaveBeenCalled();
    delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
  });
});

describe("the browser sample", () => {
  it("is a half-hour Google Meet call a minute from now", () => {
    render(<AlertWindow />);
    const start = new Date(NOW + 60_000);
    const end = new Date(NOW + 31 * 60_000);
    expect(screen.getByText(`${formatTime(start)}–${formatTime(end)}`, { exact: false })).toBeTruthy();
    expect(screen.getByText("· Google Meet")).toBeTruthy();
  });
});
