// @vitest-environment jsdom
// App settings kept in Rust: read with offline defaults, changed by commands; the glass effect on <html>
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as glass from "./glass";
import { DEFAULT_QUICK_HOTKEY } from "./hotkeys";

const mocks = vi.hoisted(() => ({
  tauri: true,
  invoke: vi.fn(async (_cmd: string, _args?: object): Promise<unknown> => undefined),
  listeners: new Map<string, (payload: unknown) => void>(),
}));
vi.mock("../api/bus", async (real) => ({
  ...(await real<object>()),
  get inTauri() {
    return mocks.tauri;
  },
  subscribe: (name: string, handler: (payload: unknown) => void) => {
    mocks.listeners.set(name, handler);
    return () => mocks.listeners.delete(name);
  },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

const load = async ({ tauri = true } = {}) => {
  mocks.tauri = tauri;
  return glass;
};

/** glassSupported is decided once on import */
const loadFresh = async ({ tauri = true, userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } = {}) => {
  mocks.tauri = tauri;
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
  vi.resetModules();
  return import("./glass");
};

/** the app refuses the command (a rejected promise made up front would be reported as unhandled) */
const fail = (message: string) =>
  mocks.invoke.mockImplementation(async () => {
    throw new Error(message);
  });

const html = document.documentElement;

const OFFLINE = {
  glass: false,
  notifications: false,
  private_notifications: false,
  alerts: "off",
  quick_hotkey: DEFAULT_QUICK_HOTKEY,
};

// mockClear, not mockReset: after a reset a throwing implementation fails the test (vitest 5)
beforeEach(() => void mocks.invoke.mockClear().mockImplementation(async () => undefined));
afterEach(() => {
  vi.restoreAllMocks();
  mocks.listeners.clear();
  delete html.dataset.glass;
  delete html.dataset.focused;
});

describe("reading the settings", () => {
  it("fills what the app left out with the offline defaults", async () => {
    const { readSettings } = await load();
    mocks.invoke.mockResolvedValue({ glass: true, alerts: "calls" });
    expect(await readSettings()).toEqual({ ...OFFLINE, glass: true, alerts: "calls" });
    expect(mocks.invoke).toHaveBeenCalledWith("get_settings");
  });

  it("are the offline defaults in a browser or when the app fails", async () => {
    const { readSettings } = await load({ tauri: false });
    expect(await readSettings()).toEqual(OFFLINE);
    expect(mocks.invoke).not.toHaveBeenCalled();
    const app = await load();
    fail("no app");
    expect(await app.readSettings()).toEqual(OFFLINE);
  });

  it("the desktop state comes from the app, else everything is off", async () => {
    const { readDesktop } = await load();
    mocks.invoke.mockResolvedValue({ widget: true, on_top: true, autostart: false });
    expect(await readDesktop()).toEqual({ widget: true, on_top: true, autostart: false });
    expect(mocks.invoke).toHaveBeenCalledWith("get_desktop");
    fail("no app");
    expect(await readDesktop()).toEqual({ widget: false, on_top: false, autostart: false });
    const browser = await load({ tauri: false });
    expect(await browser.readDesktop()).toEqual({ widget: false, on_top: false, autostart: false });
  });

  it("the glass setting comes from the app, else it is off", async () => {
    const { readGlass } = await load();
    mocks.invoke.mockResolvedValue({ glass: true });
    expect(await readGlass()).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledWith("get_settings");
    fail("no app");
    expect(await readGlass()).toBe(false);
    const browser = await load({ tauri: false });
    expect(await browser.readGlass()).toBe(false);
  });
});

describe("changing the settings", () => {
  it("sends each change to the app", async () => {
    await load();
    mocks.invoke.mockResolvedValue(true);
    await glass.setQuickHotkey("Ctrl+Alt+K");
    await glass.setQuickHotkey(null);
    await glass.setAlerts("all");
    await glass.setPrivateNotifications(true);
    await glass.setWidget({ visible: true });
    await glass.setWidget({ onTop: false });
    await glass.setNotifications(false);
    expect(await glass.setAutostart(true)).toBe(true);
    expect(mocks.invoke.mock.calls).toEqual([
      ["set_quick_hotkey", { hotkey: "Ctrl+Alt+K" }],
      ["set_quick_hotkey", { hotkey: null }],
      ["set_alerts", { mode: "all" }],
      ["set_private_notifications", { enabled: true }],
      ["set_widget", { visible: true, onTop: undefined }],
      ["set_widget", { visible: undefined, onTop: false }],
      ["set_notifications", { enabled: false }],
      ["set_autostart", { enabled: true }],
    ]);
  });

  it("a taken hotkey fails and says so", async () => {
    const { setQuickHotkey } = await load();
    fail("taken");
    await expect(setQuickHotkey("Ctrl+K")).rejects.toThrow("taken");
  });

  it("goes nowhere in a browser, where autostart stays off", async () => {
    const glass = await load({ tauri: false });
    await glass.setQuickHotkey("Ctrl+K");
    await glass.setAlerts("all");
    await glass.setPrivateNotifications(true);
    await glass.setWidget({ visible: true });
    await glass.setNotifications(true);
    await glass.setGlass(true);
    expect(await glass.setAutostart(true)).toBe(false);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});

describe("the glass effect", () => {
  it("turning it on marks the page and tells the app", async () => {
    const { setGlass } = await load();
    await setGlass(true);
    expect(html.dataset.glass).toBe("");
    await setGlass(false);
    expect(html.dataset).not.toHaveProperty("glass");
    expect(mocks.invoke.mock.calls).toEqual([
      ["set_glass", { enabled: true }],
      ["set_glass", { enabled: false }],
    ]);
  });

  it("is applied on start and follows other windows until stopped", async () => {
    const { initGlass } = await load();
    mocks.invoke.mockResolvedValue({ glass: true });
    const onChange = vi.fn();
    const stop = initGlass(onChange);
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(true));
    expect(html.dataset.glass).toBe("");

    mocks.listeners.get("glass-changed")!(false);
    expect(html.dataset).not.toHaveProperty("glass");
    expect(onChange).toHaveBeenLastCalledWith(false);
    stop();
    expect(mocks.listeners.size).toBe(0);
  });

  it("can be followed without a callback", async () => {
    const { initGlass } = await load();
    mocks.invoke.mockResolvedValue({ glass: true });
    const stop = initGlass();
    await vi.waitFor(() => expect(html.dataset.glass).toBe(""));
    mocks.listeners.get("glass-changed")!(false);
    expect(html.dataset).not.toHaveProperty("glass");
    stop();
  });

  it("marks whether the window has focus: Windows fades the glass without it", async () => {
    const { initGlass } = await load();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const stop = initGlass();
    expect(html.dataset.focused).toBe("");
    window.dispatchEvent(new Event("blur"));
    expect(html.dataset).not.toHaveProperty("focused");
    window.dispatchEvent(new Event("focus"));
    expect(html.dataset.focused).toBe("");
    stop();
    window.dispatchEvent(new Event("blur"));
    expect(html.dataset.focused).toBe("");
    delete html.dataset.focused;
    window.dispatchEvent(new Event("focus"));
    expect(html.dataset).not.toHaveProperty("focused");
  });

  it("starts unfocused when the window opened in the background", async () => {
    const { initGlass } = await load();
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    initGlass()();
    expect(html.dataset).not.toHaveProperty("focused");
  });

  it("is supported only in the app on Windows", async () => {
    expect((await loadFresh()).glassSupported).toBe(true);
    expect((await loadFresh({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)" })).glassSupported).toBe(false);
    expect((await loadFresh({ tauri: false })).glassSupported).toBe(false);
  });
});
