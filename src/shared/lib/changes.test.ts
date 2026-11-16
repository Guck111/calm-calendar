import { describe, expect, it } from "vitest";
import { createChangeTracker } from "./changes";

describe("setting changes in flight", () => {
  it("an earlier change knows it was overtaken, the latest one doesn't", () => {
    const changes = createChangeTracker<"alerts" | "notify">();
    const first = changes.start("alerts");
    const second = changes.start("alerts");
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it("settings are counted separately", () => {
    const changes = createChangeTracker<"alerts" | "notify">();
    const alerts = changes.start("alerts");
    changes.start("notify");
    expect(alerts()).toBe(true);
  });

  it("the first read may fill only settings the person hasn't changed", () => {
    const changes = createChangeTracker<"alerts" | "notify">();
    changes.start("notify");
    expect(changes.untouched("notify")).toBe(false);
    expect(changes.untouched("alerts")).toBe(true);
  });
});
