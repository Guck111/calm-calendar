// Время в пути и гости: чтение из Google, сохранение, письма гостям, занятое время
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

/** встреча 10:00–11:00 с дорогой 30 минут и одним гостем */
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

describe("время в пути", () => {
  it("читается из скрытых полей события; мусор и ноль не считаются", () => {
    expect(meeting().travelMinutes).toBe(30);
    const none = (v: string) =>
      meeting({ extendedProperties: { private: { [TRAVEL_KEY]: v } } }).travelMinutes;
    expect(none("0")).toBeUndefined();
    expect(none("abc")).toBeUndefined();
    expect(meeting({ extendedProperties: undefined }).travelMinutes).toBeUndefined();
  });

  it("сохраняется в скрытое поле; у события без дороги поле не появляется", async () => {
    await saveEvent(applyChange(fromEvent(meeting()), { travelMinutes: 45 }));
    expect(call("PATCH")?.[4].extendedProperties).toEqual({ private: { [TRAVEL_KEY]: "45" } });

    googleRequest.mockClear();
    await saveEvent(fromEvent(meeting({ extendedProperties: undefined, attendees: undefined })));
    expect(call("PATCH")?.[4]).not.toHaveProperty("extendedProperties");

    googleRequest.mockClear();
    await saveEvent(applyChange(fromEvent(meeting()), { travelMinutes: 0 }));
    expect(call("PATCH")?.[4].extendedProperties).toEqual({ private: { [TRAVEL_KEY]: "0" } });
  });

  it("новая серия «с этого и дальше» сохраняет чужие скрытые поля главного события", () => {
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

  it("дорога занята: в свободном времени и в пересечениях между аккаунтами", () => {
    const at = (h: number, mi = 0) => new Date(2026, 10, 11, h, mi);
    // встреча 10:00–11:00 по местному времени с дорогой 30 минут
    const m = meeting({ start: { dateTime: at(10).toISOString() }, end: { dateTime: at(11).toISOString() } });
    const opts = { from: 9 * 60, to: 12 * 60, minLength: 15, weekends: true };
    const [day] = freeSlots([m], [at(0)], opts, at(8));
    expect(day.slots).toEqual([
      { start: at(9), end: at(9, 30) },
      { start: at(11), end: at(12) },
    ]);
    // событие другого аккаунта 9:10–9:40 попадает на дорогу, но не на саму встречу
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

describe("гости", () => {
  it("читаются из Google вместе с организатором", () => {
    const m = meeting();
    expect(m.attendees?.map((a) => a.email)).toEqual([ME, "anna@example.com"]);
    expect(m.organizerSelf).toBe(true);
    expect(fromEvent(m).guests).toHaveLength(2);
  });

  it("у чужой встречи список гостей в черновик не попадает и не отправляется", async () => {
    const theirs = meeting({ organizer: { email: "boss@example.com" } });
    expect(theirs.organizerSelf).toBe(false);
    const draft = fromEvent(theirs);
    expect(draft.guests).toBeUndefined();
    await saveEvent(draft);
    expect(call("PATCH")?.[4]).not.toHaveProperty("attendees");
    expect(call("PATCH")?.[3]).toBeUndefined();
  });

  it("новый гость: attendees без служебных полей и письма всем гостям", async () => {
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

  it("новая встреча с гостем и удаление встречи с гостями — с письмами", async () => {
    await saveEvent({ ...fromEvent(meeting()), id: undefined, guests: [{ email: "anna@example.com" }] });
    expect(call("POST")?.[3]).toEqual({ sendUpdates: "all" });
    googleRequest.mockClear();
    await deleteOccurrence(fromEvent(meeting()), "this");
    expect(call("DELETE")?.[3]).toEqual({ sendUpdates: "all" });
  });

  it("встреча без гостей сохраняется без писем", async () => {
    await saveEvent(fromEvent(meeting({ attendees: undefined })));
    expect(call("PATCH")?.[3]).toBeUndefined();
  });
});
