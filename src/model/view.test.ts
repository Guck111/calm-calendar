// "Today" in the main window: the minute tick doesn't redraw what depends only on the date
import { allSettled, createWatch, fork } from "effector";
import { describe, expect, it } from "vitest";
import { $today, minuteTicked } from "./view";

describe("today", () => {
  it("changes when the day changes, not on every minute", async () => {
    const scope = fork();
    const updates: Date[] = [];
    createWatch({ unit: $today.updates, scope, fn: (d) => void updates.push(d) });
    for (const minute of [0, 1, 2]) await allSettled(minuteTicked, { scope, params: new Date(2026, 10, 16, 23, 57 + minute) });
    await allSettled(minuteTicked, { scope, params: new Date(2026, 10, 17, 0, 0) });
    await allSettled(minuteTicked, { scope, params: new Date(2026, 10, 17, 0, 1) });
    expect(updates.map((d) => d.getDate())).toEqual(expect.arrayContaining([17]));
    expect(updates.filter((d) => d.getDate() === 17)).toHaveLength(1);
    expect(scope.getState($today)).toEqual(new Date(2026, 10, 17));
  });
});
