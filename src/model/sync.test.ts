// Time of the last load from Google and retry when Google didn't respond
import { allSettled, fork } from "effector";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppError } from "../shared/api/types";
import { fetchEventsFx } from "./events";
import { calendarsRequested } from "./calendars";
import { connectionChanged } from "./connection";
import { $lastSynced, isTransient, retryClicked, retryDelay, retryFx, syncedText } from "./sync";
import { t } from "../shared/i18n";

afterEach(() => vi.useRealTimers());

const request = { calendars: [], range: { start: new Date(2026, 10, 9), end: new Date(2026, 10, 16) }, id: 0 };
const ok = { events: [], failed: [], lost: false, id: 0 };

const network: AppError = { kind: "network", message: "нет сети" };

describe("retry on failure", () => {
  it("retry network failures and temporary Google errors, but not access denied", () => {
    expect(isTransient(network)).toBe(true);
    for (const status of [429, 500, 502, 503, 504]) expect(isTransient({ kind: "google", message: "", status })).toBe(true);
    expect(isTransient({ kind: "google", message: "", status: 403 })).toBe(false);
    expect(isTransient({ kind: "not_signed_in", message: "" })).toBe(false);
  });

  it("after 5 seconds, 15 seconds, a minute — and that's it: then the regular refresh every 5 minutes", () => {
    expect([0, 1, 2, 3].map(retryDelay)).toEqual([5_000, 15_000, 60_000, null]);
  });

  it("a failed load starts retries with growing delay, a successful one resets the count", async () => {
    const waits: number[] = [];
    const refresh = vi.fn();
    const off = calendarsRequested.watch(refresh);
    const scope = fork({
      handlers: [
        [retryFx, async (ms: number) => void waits.push(ms)],
        [fetchEventsFx, async () => Promise.reject(network)],
      ],
    });
    for (let i = 0; i < 4; i++) await allSettled(fetchEventsFx, { scope, params: request });
    expect(waits).toEqual([5_000, 15_000, 60_000]);
    expect(refresh).toHaveBeenCalledTimes(3);

    // "Retry" in the error bar starts the count over
    await allSettled(retryClicked, { scope });
    expect(refresh).toHaveBeenCalledTimes(4);
    await allSettled(fetchEventsFx, { scope, params: request });
    expect(waits).toEqual([5_000, 15_000, 60_000, 5_000]);
    off();
  });

  it("data shown from saved copies (offline): retry too", async () => {
    const waits: number[] = [];
    const scope = fork({
      handlers: [
        [retryFx, async (ms: number) => void waits.push(ms)],
        [fetchEventsFx, async () => ok],
      ],
    });
    await allSettled(connectionChanged, { scope, params: Date.now() - 60_000 });
    await allSettled(fetchEventsFx, { scope, params: request });
    expect(waits).toEqual([5_000]);
    expect(scope.getState($lastSynced)).toBeNull();
  });
});

describe("time of the last load", () => {
  it("remembered after a successful load from Google", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 11, 10, 42));
    const scope = fork({ handlers: [[fetchEventsFx, async () => ok]] });
    await allSettled(fetchEventsFx, { scope, params: request });
    expect(scope.getState($lastSynced)).toBe(new Date(2026, 10, 11, 10, 42).getTime());
  });

  it("today — only time, earlier — date and time", () => {
    const now = new Date(2026, 10, 11, 12, 0);
    expect(syncedText(new Date(2026, 10, 11, 10, 42).getTime(), now)).toBe(t.sync.updated("10:42"));
    expect(syncedText(new Date(2026, 10, 10, 18, 5).getTime(), now)).toMatch(/18:05/);
    expect(syncedText(new Date(2026, 10, 10, 18, 5).getTime(), now)).not.toBe(t.sync.updated("18:05"));
  });
});
