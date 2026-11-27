// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { fork, type Scope } from "effector";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { $welcomeOpen } from "../model/welcome";
import { setLang } from "../shared/i18n";
import { renderIn } from "./app-scope.test-utils";
import { Welcome } from "./Welcome";

const mocks = vi.hoisted(() => ({
  tauri: true,
  readDesktop: vi.fn(async () => ({ widget: false, on_top: false, autostart: false })),
  readSettings: vi.fn(async () => ({ alerts: "off" as string, quick_hotkey: "ctrl+alt+space" as string | null })),
  setWidget: vi.fn(async (_v: object) => {}),
  setAutostart: vi.fn(async (on: boolean) => on),
  setAlerts: vi.fn(async (_mode: string) => {}),
}));
vi.mock("../shared/api/bus", async (real) => ({
  ...(await real<object>()),
  get inTauri() {
    return mocks.tauri;
  },
}));
vi.mock("../shared/lib/glass", () => ({
  readDesktop: mocks.readDesktop,
  readSettings: mocks.readSettings,
  setWidget: mocks.setWidget,
  setAutostart: mocks.setAutostart,
  setAlerts: mocks.setAlerts,
}));

beforeEach(() => {
  setLang("en");
  localStorage.clear();
  mocks.tauri = true;
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  setLang("ru");
});

const show = async (open = true) => {
  const scope: Scope = fork({ values: [[$welcomeOpen, open]] as never });
  renderIn(scope, <Welcome />);
  await act(async () => {});
  return scope;
};

const toggle = (name: string) => screen.getByRole("switch", { name: new RegExp(`^${name}`) }) as HTMLInputElement;
const failing = () => Promise.reject(new Error("no"));

describe("what else Calm Calendar can do", () => {
  it("a side card, not a dialog, with the switches, the shortcut and the tray tip", async () => {
    await show();
    const card = screen.getByRole("complementary", { name: "What else Calm Calendar can do" });
    expect(card.tagName).toBe("ASIDE");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByRole("switch")).toHaveLength(3);
    expect(screen.getByText("Press Ctrl+Alt+Space and type “tomorrow 6pm call”.")).toBeTruthy();
    expect(screen.getByText("Today's agenda by the clock")).toBeTruthy();
  });

  it("closed: nothing, and the app is not asked", async () => {
    await show(false);
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(mocks.readDesktop).not.toHaveBeenCalled();
    expect(mocks.readSettings).not.toHaveBeenCalled();
  });

  it("the switches show what the app reports; a turned-off shortcut has no tip", async () => {
    mocks.readDesktop.mockResolvedValueOnce({ widget: true, on_top: false, autostart: true });
    mocks.readSettings.mockResolvedValueOnce({ alerts: "all", quick_hotkey: null });
    await show();
    expect(toggle("Desktop widget").checked).toBe(true);
    expect(toggle("Start with Windows").checked).toBe(true);
    // all events counts as on: the switch here is calls only or off
    expect(toggle("Hard-to-miss alert").checked).toBe(true);
    expect(screen.queryByText(/^Press /)).toBeNull();
  });

  it("the widget switch shows or hides the widget; a failure turns it back", async () => {
    await show();
    fireEvent.click(toggle("Desktop widget"));
    expect(mocks.setWidget).toHaveBeenLastCalledWith({ visible: true });
    expect(toggle("Desktop widget").checked).toBe(true);
    mocks.setWidget.mockImplementationOnce(failing);
    fireEvent.click(toggle("Desktop widget"));
    await act(async () => {});
    expect(toggle("Desktop widget").checked).toBe(true);
  });

  it("launch with Windows shows what really happened, and turns back on a failure", async () => {
    mocks.setAutostart.mockResolvedValueOnce(false);
    await show();
    fireEvent.click(toggle("Start with Windows"));
    expect(toggle("Start with Windows").checked).toBe(true);
    await act(async () => {});
    expect(toggle("Start with Windows").checked).toBe(false);
    mocks.setAutostart.mockImplementationOnce(failing);
    fireEvent.click(toggle("Start with Windows"));
    await act(async () => {});
    expect(toggle("Start with Windows").checked).toBe(false);
    mocks.setAutostart.mockImplementationOnce(async (on) => on);
    fireEvent.click(toggle("Start with Windows"));
    await act(async () => {});
    expect(toggle("Start with Windows").checked).toBe(true);
  });

  it("the alert switch is calls only or off; a failure brings the old mode back", async () => {
    mocks.readSettings.mockResolvedValueOnce({ alerts: "all", quick_hotkey: null });
    await show();
    fireEvent.click(toggle("Hard-to-miss alert"));
    expect(mocks.setAlerts).toHaveBeenLastCalledWith("off");
    fireEvent.click(toggle("Hard-to-miss alert"));
    expect(mocks.setAlerts).toHaveBeenLastCalledWith("calls");
    mocks.setAlerts.mockImplementationOnce(failing);
    fireEvent.click(toggle("Hard-to-miss alert"));
    await act(async () => {});
    expect(toggle("Hard-to-miss alert").checked).toBe(true);
  });

  it("in a browser the switches are off", async () => {
    mocks.tauri = false;
    await show();
    for (const s of screen.getAllByRole("switch")) expect((s as HTMLInputElement).disabled).toBe(true);
  });

  it("Done and the cross close it for good", async () => {
    const scope = await show();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(scope.getState($welcomeOpen)).toBe(false);
    expect(localStorage.getItem("calm.welcome")).toBe("true");
    cleanup();
    const again = await show();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(again.getState($welcomeOpen)).toBe(false);
  });

  it("Esc closes it only while the focus is in the card", async () => {
    const scope = await show();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(scope.getState($welcomeOpen)).toBe(true);
    toggle("Desktop widget").focus();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(scope.getState($welcomeOpen)).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(scope.getState($welcomeOpen)).toBe(false);
  });

  it("once closed, Esc no longer reaches it", async () => {
    const scope = await show();
    toggle("Desktop widget").focus();
    cleanup();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(scope.getState($welcomeOpen)).toBe(true);
  });
});

describe("before the app answers", () => {
  it("the switches are off and no shortcut tip is shown", async () => {
    mocks.readDesktop.mockImplementationOnce(() => new Promise(() => {}));
    mocks.readSettings.mockImplementationOnce(() => new Promise(() => {}));
    await show();
    for (const s of screen.getAllByRole("switch")) expect((s as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByText(/^Press /)).toBeNull();
  });
});
