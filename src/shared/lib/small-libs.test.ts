import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Calendar, CalendarEvent } from "../api/types";
import { FONTS, FONT_NAMES, followAppearance, parseAppearance, readAppearance, saveAppearance } from "./appearance";
import { EVENT_COLORS, eventColor, isColorId } from "./colors";
import { findConflicts } from "./conflicts";
import { catchUnhandled, describeError, logInfo, logWarn, openLogsFolder } from "./log";
import { plainText } from "./plain-text";
import { nearest, type Box } from "./spatial";

const at = (h: number, m = 0) => new Date(2026, 10, 4, h, m);
const ev = (key: string, account: string, start: Date, end: Date, over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  key, id: key, calendarId: `${account}\u0000primary`, account, title: key, start, end, allDay: false, recurring: false, ...over,
});
const conflictKeys = (events: CalendarEvent[]) =>
  [...findConflicts(events)].map(([key, others]) => `${key}:${others.map((o) => o.key).join(",")}`).sort();

describe("overlaps between accounts", () => {
  it("different meetings overlap even when both have an iCalUID", () => {
    expect(conflictKeys([ev("a", "me", at(9), at(10), { iCalUID: "x" }), ev("b", "work", at(9, 30), at(10, 30), { iCalUID: "y" })]))
      .toEqual(["a:b", "b:a"]);
  });

  it("back-to-back events don't overlap", () => {
    expect(conflictKeys([ev("a", "me", at(9), at(10)), ev("b", "work", at(10), at(11))])).toEqual([]);
  });

  it("events listed out of order are still compared", () => {
    expect(conflictKeys([ev("a", "me", at(9), at(10)), ev("z", "me", at(11), at(12)), ev("b", "work", at(9, 30), at(10, 30))]))
      .toEqual(["a:b", "b:a"]);
  });
});

describe("description as text", () => {
  it("line breaks with spaces inside the tag, tags with attributes, entities", () => {
    expect(plainText('a<br />b<a href="x">link</a>')).toBe("a\nblink");
    expect(plainText("a&nbsp;b &lt;c&gt; &quot;d&quot;")).toBe('a b <c> "d"');
    expect(plainText("<p>one</p><div>two</div>")).toBe("one\ntwo");
  });
});

describe("arrows between event blocks", () => {
  const from: Box = { x: 0, y: 0, width: 100, height: 100 };
  const box = (x: number, y: number, width = 100, height = 100): Box => ({ x, y, width, height });

  it("down prefers the same column even when another column is nearer", () => {
    const below = box(0, 300);
    expect(nearest(from, [box(150, 120), below], "down")).toBe(below);
  });

  it("right takes the nearest column and in it the block nearest in time", () => {
    const level = box(200, 0);
    expect(nearest(from, [box(200, 500), level, box(400, 0)], "right")).toBe(level);
  });

  it("a block in the same column is not to the right, one shifted by half a width is", () => {
    expect(nearest(from, [box(40, 0)], "right")).toBeNull();
    expect(nearest(from, [box(60, 0, 10, 100)], "right")).toBeNull();
    const half = box(50, 0);
    expect(nearest(from, [half], "right")).toBe(half);
  });

  it("of two equally near blocks the first one listed wins", () => {
    const above = box(200, -100);
    expect(nearest(from, [above, box(200, 100)], "right")).toBe(above);
  });
});

describe("event colors", () => {
  it("eleven different Google colors", () => {
    const colors = Object.values(EVENT_COLORS);
    expect(Object.keys(EVENT_COLORS)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]);
    expect(new Set(colors).size).toBe(11);
    expect(colors.every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true);
  });

  it("a color id is a known string key", () => {
    expect([isColorId("11"), isColorId(11), isColorId("toString")]).toEqual([true, false, false]);
  });

  it("without an event the calendar color is used", () => {
    expect(eventColor(undefined, { color: "#123456" } as Calendar)).toBe("#123456");
  });
});

describe("window log in the browser", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("error text: null and objects without a kind", () => {
    expect(describeError(null)).toBe("null");
    expect(describeError({ message: "boom" })).toBe("boom");
  });

  it("warnings and info go to their console methods, a repeat within a minute is dropped", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    logWarn("slow sync");
    logWarn("slow sync");
    logInfo("started");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith("started");
    vi.advanceTimersByTime(59_999);
    logWarn("slow sync");
    expect(warn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    logWarn("slow sync");
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("after 200 different messages the memory of repeats is cleared", () => {
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    logInfo("first");
    for (let i = 0; i < 200; i++) logInfo(`message ${i}`);
    logInfo("first");
    expect(info.mock.calls.filter(([text]) => text === "first")).toHaveLength(2);
  });

  it("unhandled errors and rejections of the window are logged", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const listeners = new Map<string, (e: unknown) => void>();
    vi.stubGlobal("window", { addEventListener: (name: string, f: (e: unknown) => void) => listeners.set(name, f) });
    catchUnhandled();
    listeners.get("error")?.({ error: new Error("bad"), message: "bad" });
    listeners.get("error")?.({ message: "plain message" });
    listeners.get("unhandledrejection")?.({ reason: "nope" });
    expect(error.mock.calls.map(([text]) => String(text).split("\n")[0])).toEqual([
      "unhandled error: Error: bad",
      "unhandled error: plain message",
      "unhandled promise rejection: nope",
    ]);
  });

  it("opening the log folder does nothing outside the app", async () => {
    await expect(openLogsFolder()).resolves.toBeUndefined();
  });
});

describe("appearance setting", () => {
  let html: { dataset: Record<string, string>; style: { setProperty: () => void; removeProperty: () => void } };
  let listeners: Map<string, (e: unknown) => void>;

  beforeEach(() => {
    const items = new Map<string, string>();
    html = { dataset: {}, style: { setProperty: () => {}, removeProperty: () => {} } };
    listeners = new Map();
    vi.stubGlobal("localStorage", { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v) });
    vi.stubGlobal("document", { documentElement: html });
    vi.stubGlobal("window", {
      addEventListener: (name: string, f: (e: unknown) => void) => listeners.set(name, f),
      removeEventListener: (name: string, f: unknown) => listeners.get(name) === f && listeners.delete(name),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("every font has its own name", () => {
    const names = FONTS.map((f) => FONT_NAMES[f]);
    expect(names.every((n) => n.trim() !== "")).toBe(true);
    expect(new Set(names).size).toBe(FONTS.length);
  });

  it("'auto' is a font choice, a font too wide for text is not", () => {
    expect(parseAppearance({ style: "paper", display: "auto", text: "unbounded" })).toEqual({ style: "paper", display: "auto", text: "auto" });
  });

  it("is saved, read back and applied", () => {
    saveAppearance({ style: "obsidian", display: "inter", text: "auto" });
    expect(readAppearance()).toEqual({ style: "obsidian", display: "inter", text: "auto" });
    expect(html.dataset.style).toBe("obsidian");
  });

  it("follows a change from another window until stopped, ignoring other keys and broken values", () => {
    const onChange = vi.fn();
    const stop = followAppearance(onChange);
    const changed = listeners.get("storage");
    changed?.({ key: "calm.theme", newValue: JSON.stringify({ style: "paper" }) });
    changed?.({ key: "calm.appearance", newValue: null });
    changed?.({ key: "calm.appearance", newValue: "{broken" });
    expect(onChange).not.toHaveBeenCalled();
    changed?.({ key: "calm.appearance", newValue: JSON.stringify({ style: "paper" }) });
    expect(onChange).toHaveBeenCalledWith({ style: "paper", display: "auto", text: "auto" });
    expect(html.dataset.style).toBe("paper");
    stop();
    expect(listeners.has("storage")).toBe(false);
  });

  it("can follow without a callback", () => {
    followAppearance();
    listeners.get("storage")?.({ key: "calm.appearance", newValue: JSON.stringify({ style: "mono" }) });
    expect(html.dataset.style).toBe("mono");
  });
});
