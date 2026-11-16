// Events between windows: unsubscribing works even while Tauri is still registering the listener
import { afterEach, describe, expect, it, vi } from "vitest";

type Listener = (e: { payload: unknown }) => void;
const listeners: Listener[] = [];
let registered: (off: () => void) => void = () => {};

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(),
  // registration ends only when the test says so
  listen: (_name: string, cb: Listener) => {
    listeners.push(cb);
    return new Promise<() => void>((ok) => (registered = ok));
  },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  listeners.length = 0;
});

describe("subscribe", () => {
  it("after unsubscribing, the handler gets no events even if registration hasn't ended", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.resetModules();
    const { subscribe } = await import("./bus");
    const handler = vi.fn();
    const off = vi.fn();
    const unsubscribe = subscribe("events-changed", handler);
    unsubscribe();
    // an event arrives before Tauri finished the registration and removed the listener
    listeners.forEach((l) => l({ payload: { from: "widget" } }));
    registered(off);
    await Promise.resolve();
    await Promise.resolve();
    expect(handler).not.toHaveBeenCalled();
    expect(off).toHaveBeenCalled();
  });
});
