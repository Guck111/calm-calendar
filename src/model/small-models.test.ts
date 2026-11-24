// Small models with a stored setting: rating card, second time zone, side panel, welcome card, offline note, quick add
import { allSettled, createWatch, fork } from "effector";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { broadcast } from "../shared/api/bus";
import * as api from "../shared/api/calendar";
import type { EventDraft } from "../shared/api/types";
import { t } from "../shared/i18n";
import { logError } from "../shared/lib/log";

vi.mock("../shared/api/bus", async (original) => ({ ...(await original<typeof import("../shared/api/bus")>()), broadcast: vi.fn() }));
vi.mock("../shared/api/calendar", async (original) => ({ ...(await original<typeof import("../shared/api/calendar")>()), saveEvent: vi.fn(async () => undefined) }));
vi.mock("../shared/api/store", () => ({ isStoreBuild: vi.fn(async () => true), requestStoreRating: vi.fn(async () => Promise.reject(new Error("no store"))) }));
vi.mock("../shared/lib/log", async (original) => ({ ...(await original<typeof import("../shared/lib/log")>()), logError: vi.fn() }));

let stored: Map<string, string>;
beforeEach(() => {
  stored = new Map();
  vi.stubGlobal("localStorage", { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v) });
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.useRealTimers();
});
const store = (items: Record<string, unknown>) => {
  for (const [k, v] of Object.entries(items)) stored.set(k, JSON.stringify(v));
};

describe("rating card", () => {
  it("a valid stored state is kept, anything else starts today unanswered", async () => {
    store({ "calm.rating": { since: "2026-01-01", answered: true } });
    expect((await import("./rating")).$ratingState.getState()).toEqual({ since: "2026-01-01", answered: true });
    for (const bad of [{ since: 1, answered: true }, { since: "2026-01-01", answered: "yes" }, "x", null]) {
      vi.resetModules();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 10, 4, 12));
      store({ "calm.rating": bad });
      expect((await import("./rating")).$ratingState.getState()).toEqual({ since: "2026-11-04", answered: false });
      vi.useRealTimers();
    }
  });

  it("is due only in the Store build, after the check at start; the answer is saved; a failed Store dialog is logged", async () => {
    store({ "calm.rating": { since: "2026-01-01", answered: false }, "calm.welcome": true });
    const rating = await import("./rating");
    const { appStarted } = await import("./auth");
    const scope = fork({ handlers: [[(await import("./auth")).fetchStatusFx, async () => ({ clientSource: "file", accounts: [] })]] });
    expect(scope.getState(rating.$ratingOpen)).toBe(false);
    await allSettled(appStarted, { scope });
    expect(scope.getState(rating.$ratingOpen)).toBe(true);
    await allSettled(rating.rateClicked, { scope });
    expect(scope.getState(rating.$ratingOpen)).toBe(false);
    expect(JSON.parse(stored.get("calm.rating") ?? "{}")).toMatchObject({ answered: true });
    expect(vi.mocked(logError)).toHaveBeenCalledWith("store rating failed", expect.any(Error));
  });
});

describe("second time zone", () => {
  it("only a real zone and an explicit 'on' are taken", async () => {
    const { parseSecondZone } = await import("./zones");
    expect(parseSecondZone({ enabled: true, zone: "Asia/Tokyo" })).toEqual({ enabled: true, zone: "Asia/Tokyo" });
    expect(parseSecondZone({ enabled: "true", zone: "Mars/Base" })).toEqual({ enabled: false, zone: "UTC" });
    expect(parseSecondZone(undefined)).toEqual({ enabled: false, zone: "UTC" });
  });

  it("is off by default, follows changes, is saved and re-read from another window", async () => {
    const zones = await import("./zones");
    const scope = fork();
    expect(scope.getState(zones.$secondZone)).toBeNull();
    await allSettled(zones.secondZoneChanged, { scope, params: { zone: "Asia/Tokyo" } });
    expect(scope.getState(zones.$secondZone)).toBeNull();
    await allSettled(zones.secondZoneChanged, { scope, params: { enabled: true } });
    expect(scope.getState(zones.$secondZone)).toBe("Asia/Tokyo");
    expect(JSON.parse(stored.get("calm.secondZone") ?? "{}")).toEqual({ enabled: true, zone: "Asia/Tokyo" });
    store({ "calm.secondZone": { enabled: true, zone: "Europe/Lisbon" } });
    zones.secondZoneReloaded();
    expect(zones.$secondZone.getState()).toBe("Europe/Lisbon");
  });
});

describe("side panel", () => {
  it("in a wide window it is pinned unless stored as hidden, and the choice is saved", async () => {
    store({ "calm.sidebar": false });
    const sidebar = await import("./sidebar");
    const scope = fork();
    expect(scope.getState(sidebar.$sidebar)).toEqual({ shown: false, over: false });
    await allSettled(sidebar.sidebarToggled, { scope });
    expect(scope.getState(sidebar.$sidebar)).toEqual({ shown: true, over: false });
    expect(stored.get("calm.sidebar")).toBe("true");
  });

  it("a narrow window starts with the panel pulled in and follows the window width", async () => {
    let listener!: (e: { matches: boolean }) => void;
    const matchMedia = vi.fn(() => ({ matches: true, addEventListener: (_: string, f: typeof listener) => (listener = f) }));
    vi.stubGlobal("window", { matchMedia });
    const sidebar = await import("./sidebar");
    expect(matchMedia).toHaveBeenCalledWith("(max-width: 960px)");
    expect(sidebar.$sidebar.getState()).toEqual({ shown: false, over: true });
    listener({ matches: false });
    expect(sidebar.$sidebar.getState()).toEqual({ shown: true, over: false });
  });
});

describe("welcome card", () => {
  it("shows until closed once, then only on request", async () => {
    const first = await import("./welcome");
    const scope = fork();
    expect(scope.getState(first.$welcomeOpen)).toBe(true);
    await allSettled(first.welcomeClosed, { scope });
    expect(stored.get("calm.welcome")).toBe("true");
    vi.resetModules();
    expect((await import("./welcome")).$welcomeOpen.getState()).toBe(false);
  });
});

describe("offline note", () => {
  it("follows the cache's connection state and says how old the data is", async () => {
    const connection = await import("./connection");
    const cache = await import("../shared/api/cache");
    const at = new Date(2026, 10, 4, 9, 30).getTime();
    cache.markOffline(at);
    expect(connection.$offlineSince.getState()).toBe(at);
    expect(connection.$offlineText.getState()).toBe(connection.offlineText(at));
    cache.markOnline();
    expect(connection.$offlineText.getState()).toBeNull();
  });

  it("names the day when it isn't today", async () => {
    const { offlineText } = await import("./connection");
    const now = new Date(2026, 10, 4, 12);
    expect(offlineText(new Date(2026, 10, 4, 9, 30).getTime(), now)).toBe(t.errors.offline("09:30"));
    expect(offlineText(new Date(2026, 10, 2, 9, 30).getTime(), now)).toMatch(/^.+, 09:30/);
    expect(offlineText(new Date(2026, 10, 2, 9, 30).getTime(), now)).not.toBe(t.errors.offline("09:30"));
  });
});

describe("quick add model", () => {
  it("saves through the API, reloads, tells the other windows; an expired sign-in ends the session", async () => {
    const quick = await import("./quick");
    const { reloadRequested } = await import("./events");
    const { sessionLost } = await import("./auth");
    const draft = { title: "x" } as EventDraft;
    const scope = fork();
    const reloads = vi.fn();
    createWatch({ unit: reloadRequested, fn: reloads, scope });
    await allSettled(quick.quickCreateFx, { scope, params: draft });
    expect(vi.mocked(api.saveEvent)).toHaveBeenCalledWith(draft);
    expect(reloads).toHaveBeenCalledTimes(1);
    expect(vi.mocked(broadcast)).toHaveBeenCalledWith("events-changed", { from: "main" });
    for (const [kind, times] of [["not_signed_in", 1], ["network", 0]] as const) {
      const failing = fork({ handlers: [[quick.quickCreateFx, () => Promise.reject({ kind, message: kind })]] });
      const lost = vi.fn();
      createWatch({ unit: sessionLost, fn: lost, scope: failing });
      await allSettled(quick.quickCreateFx, { scope: failing, params: draft });
      expect(lost).toHaveBeenCalledTimes(times);
    }
  });
});
