import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock(import("@tauri-apps/api/core"), async (importOriginal) => ({
  ...(await importOriginal()),
  invoke: (...args: unknown[]) => invoke(...args),
}));
vi.mock(import("../api/bus"), async (importOriginal) => ({ ...(await importOriginal()), inTauri: true }));

const { describeError, log, logError } = await import("./log");

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
});

describe("window log", () => {
  it("error text: Error stack, error kind and text from Rust, anything else", () => {
    const e = new Error("boom");
    expect(describeError(e)).toContain("boom");
    expect(describeError(e)).toContain("log.test");
    expect(describeError({ kind: "network", message: "offline" })).toBe("network: offline");
    expect(describeError("plain")).toBe("plain");
  });

  it("goes to Rust with a level; the same message in a row is written once", () => {
    logError("save failed", { kind: "other", message: "x" });
    logError("save failed", { kind: "other", message: "x" });
    log("info", "started");
    expect(invoke.mock.calls).toEqual([
      ["log_message", { level: "error", message: "save failed: other: x" }],
      ["log_message", { level: "info", message: "started" }],
    ]);
  });

  it("a log write failure doesn't crash the window", async () => {
    invoke.mockRejectedValue(new Error("no backend"));
    expect(() => logError("another failure")).not.toThrow();
    await Promise.resolve();
  });
});
