// Время последней загрузки из Google и повтор, когда Google не ответил
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

describe("повтор при сбое", () => {
  it("повторяем сетевые сбои и временные ошибки Google, но не отказ в доступе", () => {
    expect(isTransient(network)).toBe(true);
    for (const status of [429, 500, 502, 503, 504]) expect(isTransient({ kind: "google", message: "", status })).toBe(true);
    expect(isTransient({ kind: "google", message: "", status: 403 })).toBe(false);
    expect(isTransient({ kind: "not_signed_in", message: "" })).toBe(false);
  });

  it("через 5 секунд, 15 секунд, минуту — и всё: дальше обычное обновление раз в 5 минут", () => {
    expect([0, 1, 2, 3].map(retryDelay)).toEqual([5_000, 15_000, 60_000, null]);
  });

  it("неудачная загрузка запускает повторы с нарастающей паузой, удачная сбрасывает счёт", async () => {
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

    // «Повторить» в полосе ошибки начинает счёт заново
    await allSettled(retryClicked, { scope });
    expect(refresh).toHaveBeenCalledTimes(4);
    await allSettled(fetchEventsFx, { scope, params: request });
    expect(waits).toEqual([5_000, 15_000, 60_000, 5_000]);
    off();
  });

  it("данные показаны из сохранённых (нет сети): тоже повторяем", async () => {
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

describe("время последней загрузки", () => {
  it("запоминается после удачной загрузки из Google", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 11, 10, 42));
    const scope = fork({ handlers: [[fetchEventsFx, async () => ok]] });
    await allSettled(fetchEventsFx, { scope, params: request });
    expect(scope.getState($lastSynced)).toBe(new Date(2026, 10, 11, 10, 42).getTime());
  });

  it("сегодня — только время, раньше — дата и время", () => {
    const now = new Date(2026, 10, 11, 12, 0);
    expect(syncedText(new Date(2026, 10, 11, 10, 42).getTime(), now)).toBe(t.sync.updated("10:42"));
    expect(syncedText(new Date(2026, 10, 10, 18, 5).getTime(), now)).toMatch(/18:05/);
    expect(syncedText(new Date(2026, 10, 10, 18, 5).getTime(), now)).not.toBe(t.sync.updated("18:05"));
  });
});
