// Reading calendars and events from Google: field defaults, paging, time parsing, search and ordering
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FEED_ACCOUNT } from "../lib/feeds";
import {
  calendarRef,
  listAllCalendars,
  listCalendars,
  listEvents,
  loadRecurrence,
  searchEvents,
  sortByRelevance,
  splitRef,
  toCalendarEvent,
  type RawEvent,
} from "./calendar";
import { clearCache } from "./cache";
import type { CalendarEvent } from "./types";

const googleRequest = vi.hoisted(() => vi.fn());
vi.mock("./bridge", async (original) => ({ ...(await original<typeof import("./bridge")>()), googleRequest }));

beforeEach(() => {
  googleRequest.mockReset();
  clearCache();
});

const ME = "me@x";
const CAL = calendarRef(ME, "primary");
const event = (over: Partial<RawEvent> = {}): RawEvent => ({ id: "e", start: { dateTime: "2026-11-04T09:00:00Z" }, ...over });
const read = (over: Partial<RawEvent> = {}, zone?: string) => toCalendarEvent(CAL, event(over), zone);

describe("app calendar ids", () => {
  it("an id without an account, or with an empty account, is a Google id", () => {
    expect(splitRef("primary")).toEqual({ account: "", googleId: "primary" });
    expect(splitRef(calendarRef("", "primary"))).toEqual({ account: "", googleId: "primary" });
  });
});

describe("calendar list", () => {
  it("asks for every calendar the account can read, across pages", async () => {
    googleRequest
      .mockResolvedValueOnce({ items: [{ id: "a", summary: "A", accessRole: "reader" }], nextPageToken: "p2" })
      .mockResolvedValueOnce({ items: [{ id: "b", summary: "B", accessRole: "reader" }] });
    expect((await listCalendars(ME)).map((c) => c.googleId)).toEqual(["a", "b"]);
    expect(googleRequest.mock.calls.map((c) => c.slice(0, 4))).toEqual([
      [ME, "GET", "/calendar/v3/users/me/calendarList", { minAccessRole: "reader" }],
      [ME, "GET", "/calendar/v3/users/me/calendarList", { minAccessRole: "reader", pageToken: "p2" }],
    ]);
  });

  it("fills names and colors, keeps only popup reminders, hides hidden calendars", async () => {
    googleRequest.mockResolvedValueOnce({
      items: [
        { id: "renamed", summary: "Google name", summaryOverride: "My name", accessRole: "owner", backgroundColor: "#111", foregroundColor: "#fff" },
        { id: "plain@x", accessRole: "owner", selected: true, timeZone: "Asia/Tokyo",
          defaultReminders: [{ method: "popup", minutes: 10 }, { method: "email", minutes: 30 }, { method: "popup" }, { method: "popup", minutes: 0 }] },
        { id: "hidden", summary: "Hidden", accessRole: "owner", hidden: true },
      ],
    });
    const [renamed, plain, ...rest] = await listCalendars(ME);
    expect(rest).toEqual([]);
    expect(renamed).toMatchObject({ name: "My name", color: "#111", textColor: "#fff", selected: false, defaultReminders: [] });
    expect(plain).toEqual({
      id: calendarRef(ME, "plain@x"),
      googleId: "plain@x",
      account: ME,
      name: "plain@x",
      color: "#8ab4f8",
      textColor: "#000000",
      accessRole: "owner",
      primary: false,
      selected: true,
      defaultReminders: [10, 0],
      timeZone: "Asia/Tokyo",
    });
  });

  it("primary first, then own calendars, then the rest, each group by name", async () => {
    googleRequest.mockResolvedValueOnce({
      items: [
        { id: "1", summary: "Б чужой", accessRole: "reader" },
        { id: "2", summary: "Я свой", accessRole: "owner" },
        { id: "3", summary: "А чужой", accessRole: "writer" },
        { id: "4", summary: "Ю основной", accessRole: "owner", primary: true },
        { id: "5", summary: "В свой", accessRole: "owner" },
        { id: "6", summary: "Google name", summaryOverride: "Г свой", accessRole: "owner" },
      ],
    });
    expect((await listCalendars(ME)).map((c) => c.name)).toEqual(["Ю основной", "В свой", "Г свой", "Я свой", "А чужой", "Б чужой"]);
  });

  it("no accounts is not an error; all accounts failing is the first account's error", async () => {
    expect(await listAllCalendars([])).toEqual({ calendars: [], failed: [], lost: [] });
    googleRequest.mockImplementation((account: string) => Promise.reject({ kind: "network", message: account }));
    await expect(listAllCalendars(["a@x", "b@x"])).rejects.toEqual({ kind: "network", message: "a@x" });
  });

  it("an account that failed for another reason than sign-in is not lost", async () => {
    googleRequest.mockImplementation((account: string) =>
      account === "a@x" ? Promise.reject({ kind: "network", message: "" }) : Promise.resolve({ items: [] }),
    );
    expect(await listAllCalendars(["a@x", "b@x"])).toEqual({ calendars: [], failed: ["a@x"], lost: [] });
  });
});

describe("event times", () => {
  it("a time without an offset is read in the event's or the calendar's zone, with seconds and fractions", () => {
    const at = (dateTime: string, timeZone?: string, zone?: string) => read({ start: { dateTime, timeZone } }, zone)?.start.toISOString();
    expect(at("2026-11-04T09:00", "Asia/Tokyo")).toBe("2026-11-04T00:00:00.000Z");
    expect(at("2026-11-04T09:15:30", undefined, "Asia/Tokyo")).toBe("2026-11-04T00:15:30.000Z");
    expect(at("2026-11-04T09:15:30.25", "Asia/Tokyo")).toBe("2026-11-04T00:15:30.250Z");
    expect(at("2026-11-04T09:15:30.123456", "Asia/Tokyo")).toBe("2026-11-04T00:15:30.123Z");
    expect(at("2026-11-04T09:00:00+01:00", "Asia/Tokyo")).toBe("2026-11-04T08:00:00.000Z");
    expect(at("2026-11-04T09:00:00Z", "Asia/Tokyo")).toBe("2026-11-04T09:00:00.000Z");
    expect(read({ start: { dateTime: "2026-11-04T09:00", timeZone: "Asia/Tokyo" } })?.allDay).toBe(false);
  });

  it("an end that isn't after the start becomes the default length", () => {
    const allDay = read({ start: { date: "2026-11-04" }, end: { date: "2026-11-04" } });
    expect(allDay?.end).toEqual(new Date(2026, 10, 5));
    const timed = read({ end: { dateTime: "2026-11-04T08:00:00Z" } });
    expect(timed?.end.toISOString()).toBe("2026-11-04T09:00:00.000Z");
  });

  it("an all-day event has no time zones even if Google sends them", () => {
    const e = read({ start: { date: "2026-11-04", timeZone: "Asia/Tokyo" }, end: { date: "2026-11-05", timeZone: "Europe/London" } });
    expect(e).not.toHaveProperty("timeZone");
    expect(e).not.toHaveProperty("endTimeZone");
  });

  it("an end zone is kept only when it differs from the start zone", () => {
    const start = { dateTime: "2026-11-04T09:00:00", timeZone: "Asia/Tokyo" };
    expect(read({ start, end: { dateTime: "2026-11-04T10:00:00", timeZone: "Europe/London" } })?.endTimeZone).toBe("Europe/London");
    expect(read({ start, end: { dateTime: "2026-11-04T10:00:00", timeZone: "Asia/Tokyo" } })).not.toHaveProperty("endTimeZone");
  });

  it("a time zone name the system doesn't know falls back to the calendar's, so the event still opens", () => {
    const unknown = "Mars/Olympus";
    const e = read(
      { start: { dateTime: "2026-11-04T10:00:00", timeZone: unknown }, end: { dateTime: "2026-11-04T11:00:00", timeZone: unknown } },
      "Asia/Tokyo",
    );
    expect(e?.timeZone).toBe("Asia/Tokyo");
    expect(e).not.toHaveProperty("endTimeZone");
    expect(e?.start.toISOString()).toBe("2026-11-04T01:00:00.000Z");
    expect(read({ start: { dateTime: "2026-11-04T10:00:00Z", timeZone: unknown } }, unknown)).not.toHaveProperty("timeZone");
  });
});

describe("event fields", () => {
  it("title is trimmed, free time is marked", () => {
    expect(read({ summary: "  Йога  ", transparency: "transparent" })).toMatchObject({ title: "Йога", free: true });
    expect(read({ transparency: "opaque" })?.free).toBe(false);
  });

  it("own reminders are popup ones only, otherwise the calendar's", () => {
    const overrides = [{ method: "popup", minutes: 15 }, { method: "email", minutes: 60 }];
    expect(read({ reminders: { useDefault: false, overrides } })?.reminders).toEqual([15]);
    expect(read({ reminders: { useDefault: false } })?.reminders).toEqual([]);
    expect(read({ reminders: { useDefault: true, overrides } })?.reminders).toBe("default");
    expect(read({})?.reminders).toBe("default");
  });

  it("travel time is whole minutes from 1 to 24 hours", () => {
    const travel = (value?: string) =>
      read(value === undefined ? { extendedProperties: { shared: {} } } : { extendedProperties: { private: { calmTravelMinutes: value } } })?.travelMinutes;
    expect([travel("1"), travel("1440"), travel("29.6")]).toEqual([1, 1440, 30]);
    expect([travel("0"), travel("-5"), travel("1441"), travel("soon"), travel()]).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("an organizer who isn't us makes the meeting someone else's", () => {
    expect(read({ organizer: { email: "boss@x" } })?.organizerSelf).toBe(false);
    expect(read({ organizer: { email: "me@x", self: true } })?.organizerSelf).toBe(true);
    expect(read({})?.organizerSelf).toBe(true);
  });

  it("attachments without a link are dropped, the rest lose the icon", () => {
    const e = read({
      attachments: [
        { fileUrl: "", title: "broken" },
        { fileUrl: "https://drive/1", title: "", iconLink: "https://icon", mimeType: "application/pdf", fileId: "1" },
      ],
    });
    expect(e?.attachments).toEqual([{ fileUrl: "https://drive/1", title: "https://drive/1", mimeType: "application/pdf", fileId: "1" }]);
  });
});

describe("event list", () => {
  const range = { start: new Date(Date.UTC(2026, 10, 1)), end: new Date(Date.UTC(2026, 10, 8)) };

  it("asks Google for single occurrences in the range, across pages, in the calendar's zone", async () => {
    googleRequest
      .mockResolvedValueOnce({
        timeZone: "Asia/Tokyo",
        items: [event({ id: "a", start: { dateTime: "2026-11-04T09:00:00" } }), event({ id: "gone", status: "cancelled" })],
        nextPageToken: "p2",
      })
      .mockResolvedValueOnce({ timeZone: "Europe/London", items: [event({ id: "b", start: { dateTime: "2026-11-05T09:00:00" } })] })
      .mockResolvedValueOnce({});
    const events = await listEvents(calendarRef(ME, "team@x"), range);
    expect(events.map((e) => [e.id, e.start.toISOString()])).toEqual([
      ["a", "2026-11-04T00:00:00.000Z"],
      ["b", "2026-11-05T00:00:00.000Z"],
    ]);
    const query = {
      singleEvents: "true",
      orderBy: "startTime",
      timeMin: range.start.toISOString(),
      timeMax: range.end.toISOString(),
      maxResults: "2500",
    };
    expect(googleRequest.mock.calls.map((c) => c.slice(0, 4))).toEqual([
      [ME, "GET", "/calendar/v3/calendars/team%40x/events", query],
      [ME, "GET", "/calendar/v3/calendars/team%40x/events", { ...query, pageToken: "p2" }],
    ]);
    expect(await listEvents(calendarRef(ME, "empty"), range)).toEqual([]);
  });

  it("a subscription calendar doesn't go to Google", async () => {
    expect(await listEvents(calendarRef(FEED_ACCOUNT, "missing"), range)).toEqual([]);
    expect(await searchEvents(calendarRef(FEED_ACCOUNT, "missing"), "йога", new Date())).toEqual([]);
    expect(googleRequest).not.toHaveBeenCalled();
  });
});

describe("search", () => {
  it("asks Google for 50 occurrences two years around now and reads them in the calendar's zone", async () => {
    const now = new Date(Date.UTC(2026, 10, 4));
    googleRequest.mockResolvedValueOnce({
      timeZone: "Asia/Tokyo",
      items: [event({ id: "a", start: { dateTime: "2026-11-04T09:00:00" } }), event({ id: "gone", status: "cancelled" })],
    });
    const found = await searchEvents(calendarRef(ME, "team@x"), "йога", now);
    expect(found.map((e) => [e.id, e.start.toISOString()])).toEqual([["a", "2026-11-04T00:00:00.000Z"]]);
    expect(googleRequest).toHaveBeenCalledWith(ME, "GET", "/calendar/v3/calendars/team%40x/events", {
      q: "йога",
      singleEvents: "true",
      orderBy: "startTime",
      timeMin: "2024-11-04T00:00:00.000Z",
      timeMax: "2028-11-03T00:00:00.000Z",
      maxResults: "50",
    }, undefined);
    googleRequest.mockResolvedValueOnce({});
    expect(await searchEvents(CAL, "йога", now)).toEqual([]);
  });

  it("upcoming results first, nearest first; then past ones, newest first", () => {
    const now = new Date(Date.UTC(2026, 10, 4, 12));
    const ev = (id: string, startH: number, endH: number) =>
      ({ id, start: new Date(Date.UTC(2026, 10, 4, startH)), end: new Date(Date.UTC(2026, 10, 4, endH)) }) as CalendarEvent;
    const events = [ev("old", 1, 2), ev("later", 15, 16), ev("endsNow", 11, 12), ev("recent", 9, 10), ev("soon", 13, 14)];
    expect(sortByRelevance(events, now).map((e) => e.id)).toEqual(["endsNow", "soon", "later", "recent", "old"]);
  });
});

describe("series rule", () => {
  it("a master event without a rule has an empty one", async () => {
    googleRequest.mockResolvedValueOnce({ id: "m" }).mockResolvedValueOnce({ id: "m", recurrence: ["RRULE:FREQ=DAILY"] });
    expect(await loadRecurrence(CAL, "m")).toEqual([]);
    expect(await loadRecurrence(CAL, "m")).toEqual(["RRULE:FREQ=DAILY"]);
    expect(googleRequest).toHaveBeenCalledWith(ME, "GET", "/calendar/v3/calendars/primary/events/m", undefined, undefined);
  });
});
