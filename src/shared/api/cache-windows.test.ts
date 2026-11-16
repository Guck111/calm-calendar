// The main window and the widget share one saved copy of responses in localStorage
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** localStorage shared by "windows": each window is its own copy of the module with its own memory */
const shared = new Map<string, string>();
const fakeStorage = {
  getItem: (k: string) => shared.get(k) ?? null,
  setItem: (k: string, v: string) => void shared.set(k, v),
  removeItem: (k: string) => void shared.delete(k),
};

const openWindow = async () => {
  vi.resetModules();
  return import("./cache");
};

beforeEach(() => {
  shared.clear();
  vi.stubGlobal("localStorage", fakeStorage);
});
afterEach(() => vi.unstubAllGlobals());

describe("saved responses in two windows", () => {
  it("a write from one window keeps what the other one saved", async () => {
    const main = await openWindow();
    const widget = await openWindow();
    main.remember("a", "main", 1);
    widget.recall("a");
    // the widget's memory now holds "a"; the main window adds "b", then the widget writes "c"
    main.remember("b", "main", 2);
    widget.remember("c", "widget", 3);
    expect(main.recall("b")?.body).toBe("main");
    expect(main.recall("c")?.body).toBe("widget");
  });

  it("a cache cleared in one window doesn't come back from the other window's copy", async () => {
    const main = await openWindow();
    const widget = await openWindow();
    main.remember("old", "data", 1);
    widget.recall("old");
    main.clearCache();
    widget.remember("new", "data", 2);
    expect(main.recall("old")).toBeUndefined();
    expect(main.recall("new")?.body).toBe("data");
  });
});
