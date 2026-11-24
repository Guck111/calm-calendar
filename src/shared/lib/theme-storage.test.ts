import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readJson, removeJson, saveJson, writeJson } from "./storage";
import { applyTheme, followTheme, nextTheme, readTheme, saveTheme } from "./theme";

const memoryStorage = () => {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
};
const brokenStorage = {
  getItem: () => { throw new Error("disabled"); },
  setItem: () => { throw new Error("full"); },
  removeItem: () => { throw new Error("disabled"); },
};

let storage: ReturnType<typeof memoryStorage>;
let html: { dataset: Record<string, string> };
let listeners: Map<string, (e: unknown) => void>;

beforeEach(() => {
  storage = memoryStorage();
  html = { dataset: {} };
  listeners = new Map();
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("document", { documentElement: html });
  vi.stubGlobal("window", {
    addEventListener: (name: string, f: (e: unknown) => void) => listeners.set(name, f),
    removeEventListener: (name: string, f: unknown) => listeners.get(name) === f && listeners.delete(name),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("stored settings", () => {
  it("reads what was written, and the fallback for a missing or broken value", () => {
    writeJson("k", { a: 1 });
    expect(readJson("k", null)).toEqual({ a: 1 });
    expect(readJson("missing", "fallback")).toBe("fallback");
    storage.setItem("bad", "{not json");
    expect(readJson("bad", "fallback")).toBe("fallback");
    removeJson("k");
    expect(readJson("k", "gone")).toBe("gone");
  });

  it("disabled or full storage doesn't crash, except for writes that must not fail silently", () => {
    vi.stubGlobal("localStorage", brokenStorage);
    expect(readJson("k", "fallback")).toBe("fallback");
    expect(() => writeJson("k", 1)).not.toThrow();
    expect(() => removeJson("k")).not.toThrow();
    expect(() => saveJson("k", 1)).toThrow("full");
  });
});

describe("color theme", () => {
  it("is read from storage, an unknown value is the system theme", () => {
    expect(readTheme()).toBe("system");
    storage.setItem("calm.theme", JSON.stringify("dark"));
    expect(readTheme()).toBe("dark");
    storage.setItem("calm.theme", JSON.stringify("blue"));
    expect(readTheme()).toBe("system");
  });

  it("cycles system, light, dark", () => {
    expect([nextTheme("system"), nextTheme("light"), nextTheme("dark")]).toEqual(["light", "dark", "system"]);
  });

  it("a chosen theme is set on the page, the system one removes it", () => {
    applyTheme("dark");
    expect(html.dataset.theme).toBe("dark");
    applyTheme("system");
    expect(html.dataset).not.toHaveProperty("theme");
  });

  it("saving remembers and applies the theme", () => {
    saveTheme("light");
    expect(readTheme()).toBe("light");
    expect(html.dataset.theme).toBe("light");
  });

  it("follows a valid theme saved by another window until stopped", () => {
    const onChange = vi.fn();
    const stop = followTheme(onChange);
    const changed = listeners.get("storage");
    changed?.({ key: "calm.other", newValue: JSON.stringify("dark") });
    changed?.({ key: "calm.theme", newValue: null });
    changed?.({ key: "calm.theme", newValue: JSON.stringify("blue") });
    expect(onChange).not.toHaveBeenCalled();
    changed?.({ key: "calm.theme", newValue: JSON.stringify("dark") });
    expect(onChange).toHaveBeenCalledWith("dark");
    expect(html.dataset.theme).toBe("dark");
    stop();
    expect(listeners.has("storage")).toBe(false);
  });

  it("can follow without a callback", () => {
    followTheme();
    listeners.get("storage")?.({ key: "calm.theme", newValue: JSON.stringify("light") });
    expect(html.dataset.theme).toBe("light");
  });
});
