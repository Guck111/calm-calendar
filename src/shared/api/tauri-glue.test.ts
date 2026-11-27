// Window events, external links and the Store dialog: inside Tauri they go to Rust, in a browser they stay quiet
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
const emit = vi.hoisted(() => vi.fn());
const listen = vi.hoisted(() => vi.fn());
const openUrl = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ emit, listen }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

const inApp = () => vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
const inBrowser = (win: Record<string, unknown> = {}) => vi.stubGlobal("window", win);

beforeEach(() => {
  vi.resetModules();
  [invoke, emit, listen, openUrl].forEach((f) => f.mockReset());
});
afterEach(() => vi.unstubAllGlobals());

describe("events between windows", () => {
  it("inside Tauri an event goes to every window and reaches subscribers", async () => {
    inApp();
    const handlers: ((e: { payload: unknown }) => void)[] = [];
    listen.mockImplementation(async (_name: string, cb: (e: { payload: unknown }) => void) => {
      handlers.push(cb);
      return () => {};
    });
    const { broadcast, subscribe } = await import("./bus");
    broadcast("open-date", "2026-11-04");
    expect(emit).toHaveBeenCalledWith("open-date", "2026-11-04");
    const handler = vi.fn();
    subscribe("open-date", handler);
    expect(listen).toHaveBeenCalledWith("open-date", expect.any(Function));
    handlers.forEach((h) => h({ payload: "2026-11-05" }));
    expect(handler).toHaveBeenCalledWith("2026-11-05");
  });

  it("a failed unsubscribe is ignored", async () => {
    inApp();
    listen.mockRejectedValue(new Error("window closed"));
    const { subscribe } = await import("./bus");
    const unsubscribe = subscribe("events-changed", vi.fn());
    expect(unsubscribe).not.toThrow();
    await Promise.resolve();
  });

  it("in a browser nothing is sent or listened to", async () => {
    inBrowser();
    const { broadcast, inTauri, subscribe } = await import("./bus");
    expect(inTauri).toBe(false);
    broadcast("events-changed");
    expect(() => subscribe("events-changed", vi.fn())()).not.toThrow();
    expect(emit).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
  });
});

describe("opening the main window", () => {
  it("inside Tauri Rust opens it, on a date or on today", async () => {
    inApp();
    const { openMain } = await import("./bus");
    openMain("2026-11-04");
    openMain();
    expect(invoke.mock.calls).toEqual([
      ["open_main", { date: "2026-11-04" }],
      ["open_main", { date: null }],
    ]);
  });

  it("in a browser the page goes to the calendar", async () => {
    const win = { location: { href: "/?window=widget" } };
    inBrowser(win);
    const { openMain } = await import("./bus");
    openMain("2026-11-04");
    expect(win.location.href).toBe("/?date=2026-11-04");
    openMain();
    expect(win.location.href).toBe("/");
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("external links", () => {
  it("inside Tauri open in the default browser", async () => {
    inApp();
    const { openExternal } = await import("./open");
    await openExternal("https://example.com");
    expect(openUrl).toHaveBeenCalledWith("https://example.com");
  });

  it("in a browser open in a new tab", async () => {
    const open = vi.fn();
    inBrowser({ open });
    const { openExternal } = await import("./open");
    await openExternal("https://example.com");
    expect(open).toHaveBeenCalledWith("https://example.com", "_blank", "noopener");
    expect(openUrl).not.toHaveBeenCalled();
  });
});

describe("Store rating", () => {
  it("inside Tauri Rust knows whether this is the Store build and shows the dialog", async () => {
    inApp();
    invoke.mockResolvedValueOnce(true);
    const { isStoreBuild, requestStoreRating } = await import("./store");
    expect(await isStoreBuild()).toBe(true);
    await requestStoreRating();
    expect(invoke.mock.calls).toEqual([["store_rating_available"], ["request_store_rating"]]);
  });

  it("in a browser a localStorage switch plays the Store build, and there is no dialog", async () => {
    inBrowser();
    const stored = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => stored.get(k) ?? null });
    const { isStoreBuild, requestStoreRating } = await import("./store");
    expect(await isStoreBuild()).toBe(false);
    stored.set("calm.mockStore", "1");
    expect(await isStoreBuild()).toBe(false);
    stored.set("calm.mockStore", "true");
    expect(await isStoreBuild()).toBe(true);
    await requestStoreRating();
    expect(invoke).not.toHaveBeenCalled();
  });
});
