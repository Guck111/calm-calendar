// @vitest-environment jsdom
// The color theme inside the app: the Windows title bar follows it, other windows hear about it
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTheme, followTheme, saveTheme } from "./theme";

const mocks = vi.hoisted(() => ({
  tauri: true,
  setTheme: vi.fn(async (_theme: string | null) => {}),
  broadcast: vi.fn(),
  listeners: new Map<string, (payload: unknown) => void>(),
}));
vi.mock("../api/bus", async (real) => ({
  ...(await real<object>()),
  get inTauri() {
    return mocks.tauri;
  },
  broadcast: mocks.broadcast,
  subscribe: (name: string, handler: (payload: unknown) => void) => {
    mocks.listeners.set(name, handler);
    return () => mocks.listeners.delete(name);
  },
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTheme: mocks.setTheme }) }));

const html = document.documentElement;

afterEach(() => {
  mocks.tauri = true;
  mocks.setTheme.mockReset();
  mocks.broadcast.mockReset();
  mocks.listeners.clear();
  delete html.dataset.theme;
});

describe("the title bar theme", () => {
  it("is the chosen one, or the system's", async () => {
    applyTheme("dark");
    await vi.waitFor(() => expect(mocks.setTheme).toHaveBeenLastCalledWith("dark"));
    applyTheme("system");
    await vi.waitFor(() => expect(mocks.setTheme).toHaveBeenLastCalledWith(null));
  });

  it("failing to change it is not an error", async () => {
    mocks.setTheme.mockRejectedValue(new Error("no window"));
    applyTheme("light");
    await vi.waitFor(() => expect(mocks.setTheme).toHaveBeenCalled());
    expect(html.dataset.theme).toBe("light");
  });

  it("is left alone in a browser", async () => {
    mocks.tauri = false;
    applyTheme("dark");
    await new Promise((tick) => setTimeout(tick));
    expect(mocks.setTheme).not.toHaveBeenCalled();
  });
});

describe("the theme across windows", () => {
  it("saving tells the other windows", () => {
    saveTheme("dark");
    expect(mocks.broadcast).toHaveBeenCalledWith("theme-changed", "dark");
  });

  it("a theme from another window is applied, the system one too; anything else is ignored", () => {
    const onChange = vi.fn();
    const off = followTheme(onChange);
    const changed = mocks.listeners.get("theme-changed")!;
    changed("dark");
    expect(html.dataset.theme).toBe("dark");
    changed("system");
    expect(html.dataset).not.toHaveProperty("theme");
    changed("blue");
    expect(onChange.mock.calls).toEqual([["dark"], ["system"]]);
    off();
    expect(mocks.listeners.size).toBe(0);
  });
});
