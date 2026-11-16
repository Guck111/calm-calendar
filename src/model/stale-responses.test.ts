// Responses that arrive after the person moved on (signed out, paged further) must not change the screen
import { allSettled, fork } from "effector";
import { describe, expect, it } from "vitest";
import type { AllCalendars } from "../shared/api/calendar";
import type { Calendar, CalendarEvent } from "../shared/api/types";
import { fetchStatusFx, signOutFx } from "./auth";
import { $calendars, fetchCalendarsFx } from "./calendars";
import { $events, fetchEventsFx } from "./events";

/** a promise the test resolves by hand, to choose the order of responses */
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((ok, fail) => ((resolve = ok), (reject = fail)));
  return { promise, resolve, reject };
};

const range = { start: new Date(2026, 10, 9), end: new Date(2026, 10, 16) };
const work: Calendar = { id: "work", name: "Work", color: "#000", accessRole: "owner", account: "me@gmail.com" } as Calendar;
const meeting = { key: "m", id: "m", calendarId: "work", title: "Meeting" } as unknown as CalendarEvent;

describe("sign-out drops requests already on the way", () => {
  it("a calendar list that arrives after sign-out is not shown", async () => {
    const pending = deferred<AllCalendars>();
    const scope = fork({
      handlers: [
        [fetchCalendarsFx, () => pending.promise],
        [signOutFx, async () => undefined],
        [fetchStatusFx, async () => ({ clientSource: "file" as const, accounts: [] })],
      ],
    });
    const request = allSettled(fetchCalendarsFx, { scope, params: { accounts: ["me@gmail.com"], id: 1 } });
    // allSettled waits for everything in the scope, so the sign-out starts while the request is still open
    const signOut = allSettled(signOutFx, { scope, params: undefined });
    pending.resolve({ calendars: [work], failed: [], lost: [] });
    await Promise.all([request, signOut]);
    expect(scope.getState($calendars).filter((c) => c.id === "work")).toEqual([]);
  });

  it("events that arrive after sign-out are not shown", async () => {
    const pending = deferred<{ events: CalendarEvent[]; failed: string[]; lost: boolean; id: number }>();
    const scope = fork({
      handlers: [
        [fetchEventsFx, () => pending.promise],
        [signOutFx, async () => undefined],
        [fetchStatusFx, async () => ({ clientSource: "file" as const, accounts: [] })],
      ],
    });
    const request = allSettled(fetchEventsFx, { scope, params: { calendars: [work], range, id: 0 } });
    // allSettled waits for everything in the scope, so the sign-out starts while the request is still open
    const signOut = allSettled(signOutFx, { scope, params: undefined });
    pending.resolve({ events: [meeting], failed: [], lost: false, id: 0 });
    await Promise.all([request, signOut]);
    expect(scope.getState($events)).toEqual([]);
  });
});
