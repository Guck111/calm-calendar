// Travel time and guests: reading from Google, saving, emails to guests, busy time
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "../shared/api/types";

const googleRequest = vi.fn();
vi.mock(import("../shared/api/bridge"), async (importOriginal) => ({
  ...(await importOriginal()),
  googleRequest: (...args: unknown[]) => googleRequest(...args),
}));

const { TRAVEL_KEY, deleteOccurrence, planFollowing, saveEvent, toCalendarEvent } = await import("../shared/api/calendar");
const { applyChange, fromEvent } = await import("./editor");
const { findConflicts } = await import("../shared/lib/conflicts");
const { freeSlots } = await import("../shared/lib/free");

beforeEach(() => {
  googleRequest.mockReset();
  googleRequest.mockResolvedValue({});
});

const ME = "me@example.com";
const CAL = `${ME}\u0000primary`;

/** a meeting 10:00–11:00 with 30 minutes of travel and one guest */
const meeting = (over: Record<string, unknown> = {}): CalendarEvent =>
  toCalendarEvent(CAL, {
    id: "m1",
    summary: "Встреча",
    start: { dateTime: "2026-11-11T10:00:00+01:00", timeZone: "Europe/Warsaw" },
    end: { dateTime: "2026-11-11T11:00:00+01:00", timeZone: "Europe/Warsaw" },
    extendedProperties: { private: { [TRAVEL_KEY]: "30", other: "x" } },
    organizer: { email: ME, self: true },
    attendees: [
      { email: ME, self: true, organizer: true, responseStatus: "accepted" },
      { email: "anna@example.com", responseStatus: "needsAction" },
    ],
    ...over,
  }) as CalendarEvent;

const call = (method: string) => googleRequest.mock.calls.find((c) => c[1] === method);

describe("travel time", () => {
  it("read from hidden event fields; garbage and zero are ignored", () => {
    expect(meeting().travelMinutes).toBe(30);
    const none = (v: string) =>
      meeting({ extendedProperties: { private: { [TRAVEL_KEY]: v } } }).travelMinutes;
    expect(none("0")).toBeUndefined();
    expect(none("abc")).toBeUndefined();
    expect(meeting({ extendedProperties: undefined }).travelMinutes).toBeUndefined();
  });

  it("saved to a hidden field; an event without travel doesn't get the field", async () => {
    await saveEvent(applyChange(fromEvent(meeting()), { travelMinutes: 45 }));
    expect(call("PATCH")?.[4].extendedProperties).toEqual({ private: { [TRAVEL_KEY]: "45" } });

    googleRequest.mockClear();
    await saveEvent({ ...fromEvent(meeting({ extendedProperties: undefined, attendees: undefined })), title: "Новое" });
    expect(call("PATCH")?.[4]).not.toHaveProperty("extendedProperties");

    googleRequest.mockClear();
    await saveEvent(applyChange(fromEvent(meeting()), { travelMinutes: 0 }));
    expect(call("PATCH")?.[4].extendedProperties).toEqual({ private: { [TRAVEL_KEY]: "0" } });
  });

  it("new 'this and following' series keeps the master event's foreign hidden fields", () => {
    const draft = { ...fromEvent(meeting()), travelMinutes: 15, recurringEventId: "s", originalStart: { dateTime: "2026-11-11T09:00:00Z" } };
    const master = {
      id: "s",
      start: { dateTime: "2026-11-04T09:00:00Z" },
      recurrence: ["RRULE:FREQ=WEEKLY"],
      extendedProperties: { private: { other: "x" }, shared: { s: "1" } },
    };
    const plan = planFollowing(draft, master, 0);
    expect(plan.kind).toBe("split");
    if (plan.kind === "split")
      expect(plan.create.extendedProperties).toEqual({ private: { other: "x", [TRAVEL_KEY]: "15" }, shared: { s: "1" } });
  });

  it("travel is busy: in free time and in overlaps between accounts", () => {
    const at = (h: number, mi = 0) => new Date(2026, 10, 11, h, mi);
    // a meeting 10:00–11:00 local time with 30 minutes of travel
    const m = meeting({ start: { dateTime: at(10).toISOString() }, end: { dateTime: at(11).toISOString() } });
    const opts = { from: 9 * 60, to: 12 * 60, minLength: 15, weekends: true };
    const [day] = freeSlots([m], [at(0)], opts, at(8));
    expect(day.slots).toEqual([
      { start: at(9), end: at(9, 30) },
      { start: at(11), end: at(12) },
    ]);
    // an event from another account 9:10–9:40 falls on the travel time, but not on the meeting itself
    const other: CalendarEvent = {
      ...m,
      key: "w",
      id: "w",
      account: "work@example.com",
      calendarId: "w",
      travelMinutes: undefined,
      start: at(9, 10),
      end: at(9, 40),
    };
    expect(findConflicts([m, other]).get(m.key)?.map((e) => e.key)).toEqual(["w"]);
  });
});

describe("guests", () => {
  it("read from Google together with the organizer", () => {
    const m = meeting();
    expect(m.attendees?.map((a) => a.email)).toEqual([ME, "anna@example.com"]);
    expect(m.organizerSelf).toBe(true);
    expect(fromEvent(m).guests).toHaveLength(2);
  });

  it("for someone else's meeting the guest list doesn't go into the draft and isn't sent", async () => {
    const theirs = meeting({ organizer: { email: "boss@example.com" } });
    expect(theirs.organizerSelf).toBe(false);
    const draft = fromEvent(theirs);
    expect(draft.guests).toBeUndefined();
    await saveEvent({ ...draft, title: "Новое" });
    expect(call("PATCH")?.[4]).not.toHaveProperty("attendees");
    expect(call("PATCH")?.[3]).toBeUndefined();
  });

  it("new guest: attendees without service fields and emails to all guests", async () => {
    const draft = applyChange(fromEvent(meeting()), {
      guests: [...(fromEvent(meeting()).guests ?? []), { email: "bob@example.com" }],
    });
    await saveEvent(draft);
    const [, , , query, body] = call("PATCH") ?? [];
    expect(query).toEqual({ sendUpdates: "all" });
    expect(body.attendees).toEqual([
      { email: ME, responseStatus: "accepted" },
      { email: "anna@example.com", responseStatus: "needsAction" },
      { email: "bob@example.com" },
    ]);
  });

  it("new meeting with a guest and deleting a meeting with guests — with emails", async () => {
    await saveEvent({ ...fromEvent(meeting()), id: undefined, guests: [{ email: "anna@example.com" }] });
    expect(call("POST")?.[3]).toEqual({ sendUpdates: "all" });
    googleRequest.mockClear();
    await deleteOccurrence(fromEvent(meeting()), "this");
    expect(call("DELETE")?.[3]).toEqual({ sendUpdates: "all" });
  });

  it("a meeting without guests is saved without emails", async () => {
    await saveEvent(fromEvent(meeting({ attendees: undefined })));
    expect(call("PATCH")?.[3]).toBeUndefined();
  });
});
