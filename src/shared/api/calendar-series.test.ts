import { beforeEach, describe, expect, it, vi } from "vitest";
import { occurrences, parseRecurrence } from "../lib/rrule";
import { toDateKey } from "../lib/date";
import { deleteOccurrence, occurrenceStart, planFollowing, saveEvent, toCalendarEvent, type RawEvent } from "./calendar";
import type { EventDraft } from "./types";

const googleRequest = vi.hoisted(() => vi.fn());
vi.mock("./bridge", async (original) => ({
  ...await original<typeof import("./bridge")>(),
  googleRequest,
}));

beforeEach(() => googleRequest.mockReset());

const series = (over: Partial<RawEvent> = {}): RawEvent => ({
  id: "series",
  start: { dateTime: "2026-11-04T00:00:00Z", timeZone: "UTC" },
  end: { dateTime: "2026-11-04T01:00:00Z", timeZone: "UTC" },
  recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"],
  ...over,
});

const draft = (master: RawEvent, date: string, over: Partial<EventDraft> = {}): EventDraft => ({
  id: "occurrence",
  calendarId: "primary",
  recurringEventId: master.id,
  title: "Edited",
  allDay: false,
  startDate: date,
  endDate: date,
  startTime: "00:00",
  endTime: "01:00",
  timeZone: "UTC",
  originalStart: { dateTime: date + "T00:00:00Z" },
  originalRecurrence: master.recurrence,
  recurrence: master.recurrence ?? [],
  location: "",
  description: "",
  ...over,
});

describe("Google recurrence boundaries", () => {
  it("1. reads offset-free times and original starts in their explicit Google zones", () => {
    const timeZone = "Asia/Tokyo";
    const master = series({
      start: { dateTime: "2026-11-04T09:00:00", timeZone },
      end: { dateTime: "2026-11-04T10:00:00", timeZone },
    });
    const originalStartTime = { dateTime: "2026-11-11T09:00:00", timeZone };
    const event = toCalendarEvent("primary", {
      id: "occurrence",
      recurringEventId: master.id,
      start: { dateTime: "2026-11-12T09:00:00", timeZone },
      end: { dateTime: "2026-11-12T02:00:00+01:00", timeZone },
      originalStartTime,
    });
    expect(event).not.toBeNull();
    if (!event) return;
    expect.soft(event.start.toISOString()).toBe("2026-11-12T00:00:00.000Z");
    expect.soft(event.end.toISOString()).toBe("2026-11-12T01:00:00.000Z");
    expect.soft(occurrenceStart(event).toISOString()).toBe("2026-11-11T00:00:00.000Z");
    expect.soft(planFollowing(draft(master, "2026-11-12", { originalStart: originalStartTime }), master, 0))
      .toMatchObject({ kind: "split", truncate: { recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261110T235959Z"] } });
  });

  it("2. assigns each RDATE to its side of a split and removes future RDATEs on deletion", async () => {
    const master = series({
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=WE",
        "RDATE;TZID=Asia/Tokyo:20261104T090000,20261111T090000,20261125T090000",
        "RDATE:20261109T000000Z,20261120T000000Z",
        "EXDATE:20261118T000000Z",
      ],
    });
    const edited = draft(master, "2026-11-11");
    const before = [
      "RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261110T235959Z",
      "RDATE;TZID=Asia/Tokyo:20261104T090000",
      "RDATE:20261109T000000Z",
      "EXDATE:20261118T000000Z",
    ];
    const after = [
      "RRULE:FREQ=WEEKLY;BYDAY=WE",
      "RDATE;TZID=Asia/Tokyo:20261111T090000,20261125T090000",
      "RDATE:20261120T000000Z",
      "EXDATE:20261118T000000Z",
    ];
    expect.soft(planFollowing(edited, master, 0))
      .toMatchObject({ kind: "split", truncate: { recurrence: before }, create: { recurrence: after } });
    expect.soft(planFollowing({ ...edited, recurrence: ["RRULE:FREQ=DAILY", ...master.recurrence!.slice(1)] }, master, 0))
      .toMatchObject({ kind: "split", create: { recurrence: ["RRULE:FREQ=DAILY", ...after.slice(1)] } });

    googleRequest.mockResolvedValueOnce(master).mockResolvedValueOnce({});
    await deleteOccurrence(edited, "following");
    expect.soft(googleRequest.mock.calls.find(([, method]) => method === "PATCH")?.[4]).toEqual({ recurrence: before });

    const allDay = series({
      start: { date: "2026-11-04" },
      end: { date: "2026-11-05" },
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE", "RDATE;VALUE=DATE:20261108,20261115"],
    });
    expect.soft(planFollowing(draft(allDay, "2026-11-11", {
      allDay: true,
      originalStart: { date: "2026-11-11" },
    }), allDay, 0)).toMatchObject({
      kind: "split",
      truncate: { recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261110", "RDATE;VALUE=DATE:20261108"] },
      create: { recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE", "RDATE;VALUE=DATE:20261115"] },
    });
  });

  it("3. counts a moved occurrence before the split by original start across Google pages", async () => {
    const master = series({ recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=3"] });
    const moved = {
      id: "first-moved",
      start: { dateTime: "2026-11-20T00:00:00Z" },
      originalStartTime: { dateTime: "2026-11-04T00:00:00Z" },
    };
    const current = { id: "second", start: { dateTime: "2026-11-11T00:00:00Z" } };
    const next = { id: "third", start: { dateTime: "2026-11-18T00:00:00Z" } };
    googleRequest.mockImplementation(async (_account, method, path, query) => {
      if (method === "GET" && path.endsWith("/instances")) {
        const rows = query.pageToken ? [moved] : [current, next];
        const items = rows.filter((row) => !query.timeMax || row.start.dateTime < query.timeMax);
        return { items, ...(query.pageToken ? {} : { nextPageToken: "next-page" }) };
      }
      if (method === "GET") return master;
      return { id: "new-series" };
    });

    await saveEvent(draft(master, "2026-11-11"), "following");
    expect(googleRequest.mock.calls.find(([, method]) => method === "POST")?.[4]).toMatchObject({
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=2"],
    });
  });

  it("4. preserves an explicit Sunday week start and the biweekly pairing across a split", () => {
    const master = series({
      start: { dateTime: "2026-11-01T00:00:00Z", timeZone: "UTC" },
      recurrence: ["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO;WKST=SU"],
    });
    const plan = planFollowing(draft(master, "2026-11-15"), master, 0);
    expect(plan.kind).toBe("split");
    if (plan.kind !== "split") return;
    const lines = plan.create.recurrence as string[];
    expect.soft(lines[0].split(";")).toContain("WKST=SU");
    const start = new Date(2026, 10, 15, 9);
    const { rule } = parseRecurrence(lines, start);
    expect(rule).not.toBeNull();
    if (rule) {
      expect.soft(occurrences(rule, start, new Date(2026, 11, 1)).map(toDateKey))
        .toEqual(["2026-11-15", "2026-11-16", "2026-11-29", "2026-11-30"]);
    }
  });

  it("5. follows a Wednesday series moved to Thursday while changing Tokyo to London", () => {
    const master = series({
      start: { dateTime: "2026-11-04T07:00:00+09:00", timeZone: "Asia/Tokyo" },
      end: { dateTime: "2026-11-04T08:00:00+09:00", timeZone: "Asia/Tokyo" },
    });
    const edited = draft(master, "2026-11-12", {
      timeZone: "Europe/London",
      startTime: "07:00",
      endTime: "08:00",
      originalStart: { dateTime: "2026-11-11T07:00:00+09:00", timeZone: "Asia/Tokyo" },
    });
    expect(planFollowing(edited, master, 0)).toMatchObject({
      kind: "split",
      create: {
        start: { dateTime: "2026-11-12T07:00:00.000Z", timeZone: "Europe/London" },
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TH"],
      },
    });
  });
});
