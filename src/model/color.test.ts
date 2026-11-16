// Color of a single event (Google colorId): reading, form, saving, on-screen color
import { allSettled, fork } from "effector";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Calendar, CalendarEvent } from "../shared/api/types";

const googleRequest = vi.fn();
vi.mock(import("../shared/api/bridge"), async (importOriginal) => ({
  ...(await importOriginal()),
  googleRequest: (...args: unknown[]) => googleRequest(...args),
}));

const { draftToBody, saveEvent, toCalendarEvent } = await import("../shared/api/calendar");
const { applyChange, eventPatched, fromEvent, moveFx } = await import("./editor");
const { EVENT_COLORS, eventColor } = await import("../shared/lib/colors");

beforeEach(() => {
  googleRequest.mockReset();
  googleRequest.mockResolvedValue({});
});

const CAL = "me@example.com\u0000primary";
const calendar = { id: CAL, color: "#4f8ef7" } as Calendar;

const event = (over: Record<string, unknown> = {}): CalendarEvent =>
  toCalendarEvent(CAL, {
    id: "e1",
    summary: "Йога",
    start: { dateTime: "2026-11-11T18:00:00Z" },
    end: { dateTime: "2026-11-11T19:00:00Z" },
    ...over,
  }) as CalendarEvent;

const call = (method: string) => googleRequest.mock.calls.find((c) => c[1] === method);

describe("event color", () => {
  it("11 Google colors, as in its web version", () => {
    expect(Object.keys(EVENT_COLORS)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]);
    expect(EVENT_COLORS["11"]).toBe("#d50000");
  });

  it("read from Google; unknown id is ignored", () => {
    expect(event({ colorId: "4" }).colorId).toBe("4");
    expect(event({ colorId: "99" }).colorId).toBeUndefined();
    expect(event().colorId).toBeUndefined();
  });

  it("on screen — the event color, without it — the calendar color", () => {
    expect(eventColor(event({ colorId: "2" }), calendar)).toBe(EVENT_COLORS["2"]);
    expect(eventColor(event(), calendar)).toBe("#4f8ef7");
    expect(eventColor(event(), undefined)).toBe("#8ab4f8");
  });

  it("in the form: own color or empty string — calendar color", () => {
    expect(fromEvent(event({ colorId: "6" })).colorId).toBe("6");
    expect(fromEvent(event()).colorId).toBe("");
  });

  it("saved in colorId; 'calendar color' resets it", async () => {
    expect(draftToBody(applyChange(fromEvent(event()), { colorId: "5" }))).toHaveProperty("colorId", "5");
    await saveEvent(applyChange(fromEvent(event({ colorId: "5" })), { colorId: "" }));
    expect(call("PATCH")?.[4]).toHaveProperty("colorId", null);
  });

  it("new event without a color doesn't send colorId", async () => {
    const { id: _, ...draft } = fromEvent(event());
    await saveEvent(draft);
    expect(call("POST")?.[4]).not.toHaveProperty("colorId");
  });
});

describe("quick changes in a row", () => {
  const bodies = () => googleRequest.mock.calls.filter((c) => c[1] === "PATCH").map((c) => c[4] as Record<string, unknown>);

  it("a new color and a drag right after: each sends only its own fields", async () => {
    const yoga = event({ colorId: "5" });
    const scope = fork();
    const hour = 3_600_000;
    // both start from the same copy of the event, before Google answered the first one
    await Promise.all([
      allSettled(eventPatched, { scope, params: { event: yoga, patch: { colorId: "11" } } }),
      allSettled(moveFx, {
        scope,
        params: { event: yoga, start: new Date(yoga.start.getTime() + hour), end: new Date(yoga.end.getTime() + hour) },
      }),
    ]);
    const [color, move] = bodies();
    expect(color).toEqual({ colorId: "11" });
    expect(Object.keys(move).sort()).toEqual(["end", "start"]);
  });
});
