import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppError } from "./types";

const googleRequest = vi.fn();
vi.mock("./bridge", () => ({
  googleRequest: (...args: unknown[]) => googleRequest(...args),
  isAppError: (e: unknown) => typeof e === "object" && e !== null && "kind" in e,
}));

const { cacheKey, clearCache, markOnline, onConnectionChange, recall, remember } = await import("./cache");
const { readWithCache } = await import("./calendar");

const network: AppError = { kind: "network", message: "offline" };

beforeEach(() => {
  clearCache();
  markOnline();
  googleRequest.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("saved responses", () => {
  it("are found by path and query", () => {
    remember(cacheKey("/calendar/v3/x", { a: "1" }), { items: [1] }, 1000);
    expect(recall(cacheKey("/calendar/v3/x", { a: "1" }))).toEqual({ at: 1000, body: { items: [1] } });
    expect(recall(cacheKey("/calendar/v3/x", { a: "2" }))).toBeUndefined();
  });

  it("keep only the latest 80 requests", () => {
    for (let i = 0; i < 85; i++) remember(`k${i}`, i, i);
    expect(recall("k4")).toBeUndefined();
    expect(recall("k5")?.body).toBe(5);
    expect(recall("k84")?.body).toBe(84);
  });
});

describe("reading with a fallback", () => {
  it("remembers a live answer", async () => {
    googleRequest.mockResolvedValueOnce({ items: ["live"] });
    expect(await readWithCache("me@example.com", "/calendar/v3/p", { q: "1" })).toEqual({ items: ["live"] });
    expect(recall(`me@example.com|${cacheKey("/calendar/v3/p", { q: "1" })}`)?.body).toEqual({ items: ["live"] });
  });

  it("without network returns the saved answer and reports when it is from", async () => {
    remember(`me@example.com|${cacheKey("/calendar/v3/p", { q: "1" })}`, { items: ["saved"] }, 5000);
    const seen: (number | null)[] = [];
    const off = onConnectionChange((at) => seen.push(at));
    googleRequest.mockRejectedValueOnce(network);
    expect(await readWithCache("me@example.com", "/calendar/v3/p", { q: "1" })).toEqual({ items: ["saved"] });
    googleRequest.mockResolvedValueOnce({ items: [] });
    await readWithCache("me@example.com", "/calendar/v3/p", { q: "1" });
    off();
    expect(seen).toEqual([5000, null]);
  });

  it("passes other errors and misses through", async () => {
    remember(`me@example.com|${cacheKey("/calendar/v3/p", {})}`, { items: [] });
    googleRequest.mockRejectedValueOnce({ kind: "not_signed_in", message: "" });
    await expect(readWithCache("me@example.com", "/calendar/v3/p", {})).rejects.toMatchObject({ kind: "not_signed_in" });
    googleRequest.mockRejectedValueOnce(network);
    await expect(readWithCache("me@example.com", "/calendar/v3/other", {})).rejects.toMatchObject({ kind: "network" });
  });

  it("keeps answers of different accounts apart", async () => {
    googleRequest.mockResolvedValueOnce({ items: ["mine"] });
    await readWithCache("me@example.com", "/calendar/v3/users/me/calendarList", {});
    googleRequest.mockRejectedValueOnce(network);
    // у второго аккаунта тот же путь, но сохранённого ответа нет: чужие календари не показываем
    await expect(readWithCache("work@example.com", "/calendar/v3/users/me/calendarList", {})).rejects.toMatchObject({
      kind: "network",
    });
    expect(googleRequest).toHaveBeenLastCalledWith("work@example.com", "GET", "/calendar/v3/users/me/calendarList", {});
  });
});
