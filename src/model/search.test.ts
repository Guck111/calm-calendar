// Event search: what the list under the input shows
import { allSettled, fork } from "effector";
import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "../shared/api/types";
import { $results, queryChanged, searchFx, searchRequested } from "./search";

const dentist = { key: "d", id: "d", calendarId: "c", title: "Dentist" } as unknown as CalendarEvent;

describe("search results", () => {
  it("results of the previous text are not shown under the new one", async () => {
    const scope = fork({ handlers: [[searchFx, async ({ id }: { id: number }) => ({ id, results: [dentist] })]] });
    await allSettled(queryChanged, { scope, params: "dentist" });
    await allSettled(searchRequested, { scope });
    expect(scope.getState($results)).toEqual([dentist]);

    // the next search waits for a pause in typing; until then Enter must have nothing to open
    await allSettled(queryChanged, { scope, params: "lunch" });
    expect(scope.getState($results)).toBeNull();
  });

  it("a late answer for the previous text is not shown either", async () => {
    let answer!: () => void;
    const scope = fork({
      handlers: [[searchFx, ({ id }: { id: number }) => new Promise((ok) => (answer = () => ok({ id, results: [dentist] })))]],
    });
    await allSettled(queryChanged, { scope, params: "dentist" });
    // allSettled waits for the open search too, so the new text is typed without waiting
    const steps = [allSettled(searchRequested, { scope }), allSettled(queryChanged, { scope, params: "lunch" })];
    answer();
    await Promise.all(steps);
    expect(scope.getState($results)).toBeNull();
  });
});
