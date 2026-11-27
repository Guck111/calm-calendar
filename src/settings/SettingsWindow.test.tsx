// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../shared/i18n";
import { SettingsWindow } from "./SettingsWindow";

const mocks = vi.hoisted(() => ({
  tauri: true,
  invoke: vi.fn(async (cmd: string, _args?: object): Promise<unknown> => (cmd === "get_settings" ? { notifications: false } : undefined)),
  broadcast: vi.fn((_name: string, _payload?: unknown) => {}),
  startDragging: vi.fn(async () => {}),
}));
vi.mock("../shared/api/bus", async (real) => ({
  ...(await real<object>()),
  get inTauri() {
    return mocks.tauri;
  },
  broadcast: mocks.broadcast,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ startDragging: mocks.startDragging, setTheme: async () => {} }) }));
vi.mock("../shared/lib/glass", async (real) => ({
  ...(await real<object>()),
  initGlass: () => () => {},
  readDesktop: async () => ({ widget: false, on_top: false, autostart: false }),
  readSettings: async () => ({ notifications: false, private_notifications: false, alerts: "off", quick_hotkey: null }),
  setNotifications: async () => {},
}));
vi.mock("../shared/api/store", () => ({ isStoreBuild: async () => false }));

beforeEach(() => {
  setLang("en");
  mocks.tauri = true;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setLang("ru");
});

const show = async () => {
  render(<SettingsWindow />);
  await act(async () => {});
  return screen.getByRole("heading", { level: 2, name: "Settings" }).parentElement as HTMLElement;
};

describe("settings window", () => {
  it("is the settings in a window of its own: not modal", async () => {
    await show();
    expect(screen.getByRole("dialog", { name: "Settings" }).getAttribute("aria-modal")).toBe("false");
  });

  it("the cross and Esc close the window", async () => {
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(mocks.invoke.mock.calls.filter(([cmd]) => cmd === "close_settings")).toHaveLength(2);
  });

  it("in a browser closing does nothing", async () => {
    mocks.tauri = false;
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(mocks.invoke).not.toHaveBeenCalledWith("close_settings");
  });

  it("the header drags the window, but not from its buttons and only with the left button", async () => {
    const head = await show();
    fireEvent.pointerDown(head, { button: 2 });
    fireEvent.pointerDown(screen.getByRole("button", { name: "Close" }), { button: 0 });
    expect(mocks.startDragging).not.toHaveBeenCalled();
    expect(fireEvent.pointerDown(head, { button: 0 })).toBe(false);
    expect(mocks.startDragging).toHaveBeenCalledTimes(1);
  });

  it("in a browser the header doesn't drag", async () => {
    mocks.tauri = false;
    const head = await show();
    expect(fireEvent.pointerDown(head, { button: 0 })).toBe(true);
    expect(mocks.startDragging).not.toHaveBeenCalled();
  });

  it("turning reminders on tells the calendar window to reschedule them", async () => {
    await show();
    fireEvent.click(screen.getByRole("tab", { name: "Reminders" }));
    fireEvent.click(screen.getByRole("switch", { name: /^Event notifications/ }));
    await act(async () => {});
    expect(mocks.broadcast).toHaveBeenCalledWith("events-changed", { from: "settings" });
  });
});
