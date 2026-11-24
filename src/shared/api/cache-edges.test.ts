// Saved responses when storage is broken, full or missing, and the offline notice
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "calm.cache.v1";
let stored: Map<string, string>;

const storageWith = (over: Partial<Storage> = {}) => ({
  getItem: (k: string) => stored.get(k) ?? null,
  setItem: (k: string, v: string) => void stored.set(k, v),
  removeItem: (k: string) => void stored.delete(k),
  ...over,
});

const freshCache = async () => {
  vi.resetModules();
  return import("./cache");
};

const savedKeys = () => Object.keys(JSON.parse(stored.get(KEY) ?? "{}")).sort();

beforeEach(() => {
  stored = new Map();
});
afterEach(() => vi.unstubAllGlobals());

describe("saved responses in storage", () => {
  it("survive a restart", async () => {
    vi.stubGlobal("localStorage", storageWith());
    (await freshCache()).remember("a", { items: [1] }, 10);
    expect((await freshCache()).recall("a")).toEqual({ at: 10, body: { items: [1] } });
  });

  it("over the limit the oldest responses go first, not the first written", async () => {
    vi.stubGlobal("localStorage", storageWith());
    const cache = await freshCache();
    for (let i = 0; i < 79; i++) cache.remember(`k${i}`, i, 100 + i);
    cache.remember("stale", "old", 1);
    cache.remember("fresh", "new", 500);
    expect(cache.recall("stale")).toBeUndefined();
    expect(cache.recall("k0")?.body).toBe(0);
    expect(cache.recall("fresh")?.body).toBe("new");
  });

  it("broken saved data counts as empty", async () => {
    stored.set(KEY, "{not json");
    vi.stubGlobal("localStorage", storageWith());
    const cache = await freshCache();
    expect(cache.recall("a")).toBeUndefined();
    cache.remember("a", 1, 1);
    expect(cache.recall("a")?.body).toBe(1);
  });

  it("when storage is full, the newer half is kept", async () => {
    let room = Infinity;
    vi.stubGlobal(
      "localStorage",
      storageWith({
        setItem: (k: string, v: string) => {
          if (Object.keys(JSON.parse(v)).length > room) throw new Error("QuotaExceededError");
          stored.set(k, v);
        },
      }),
    );
    const cache = await freshCache();
    for (let i = 1; i <= 6; i++) cache.remember(`k${i}`, i, i);
    room = 4;
    cache.remember("k7", 7, 7);
    expect(savedKeys()).toEqual(["k5", "k6", "k7"]);
    expect(cache.recall("k4")).toBeUndefined();
    expect(cache.recall("k7")?.body).toBe(7);
  });

  it("when nothing fits, saving gives up without an error", async () => {
    vi.stubGlobal(
      "localStorage",
      storageWith({
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      }),
    );
    const cache = await freshCache();
    expect(() => cache.remember("a", 1, 1)).not.toThrow();
    expect(stored.has(KEY)).toBe(false);
  });

  it("without storage responses live in memory", async () => {
    vi.stubGlobal("localStorage", undefined);
    const cache = await freshCache();
    cache.remember("a", 1, 1);
    expect(cache.recall("a")?.body).toBe(1);
    cache.clearCache();
    expect(cache.recall("a")).toBeUndefined();
  });

  it("storage that throws on access works like no storage", async () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("SecurityError");
      },
    });
    try {
      const cache = await freshCache();
      cache.remember("a", 1, 1);
      expect(cache.recall("a")?.body).toBe(1);
      expect(() => cache.clearCache()).not.toThrow();
      expect(cache.recall("a")).toBeUndefined();
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  it("clearing works even if storage refuses to remove", async () => {
    vi.stubGlobal(
      "localStorage",
      storageWith({
        removeItem: () => {
          throw new Error("SecurityError");
        },
      }),
    );
    const cache = await freshCache();
    cache.remember("a", 1, 1);
    expect(() => cache.clearCache()).not.toThrow();
  });
});

describe("offline notice", () => {
  it("tells listeners the time of the oldest shown data, once per change", async () => {
    const cache = await freshCache();
    const seen: (number | null)[] = [];
    const off = cache.onConnectionChange((at) => seen.push(at));
    cache.markOffline(500);
    cache.markOffline(700);
    cache.markOffline(300);
    cache.markOnline();
    cache.markOnline();
    off();
    cache.markOffline(100);
    expect(seen).toEqual([500, 300, null]);
  });
});
