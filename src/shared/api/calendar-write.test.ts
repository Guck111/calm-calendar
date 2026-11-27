// Writing to Google: request bodies, only changed fields, series edits and deletions, invitation responses
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bodyBaseline,
  calendarRef,
  deleteOccurrence,
  draftToBody,
  followingRecurrence,
  moveEvent,
  myResponse,
  occurrenceStart,
  patchEvent,
  planFollowing,
  respondToEvent,
  saveEvent,
  withResponse,
  type RawEvent,
} from "./calendar";
import type { CalendarEvent, EventDraft } from "./types";

const googleRequest = vi.hoisted(() => vi.fn());
vi.mock("./bridge", async (original) => ({ ...(await original<typeof import("./bridge")>()), googleRequest }));

beforeEach(() => {
  googleRequest.mockReset();
  googleRequest.mockResolvedValue({ id: "created" });
});
afterEach(() => vi.unstubAllGlobals());

const ME = "me@x";
const PRIMARY = calendarRef(ME, "primary");
const EVENTS = "/calendar/v3/calendars/primary/events";
const GUEST = { email: "guest@x" };

const draft = (over: Partial<EventDraft> = {}): EventDraft => ({
  calendarId: PRIMARY,
  title: "Встреча",
  allDay: false,
  startDate: "2026-11-04",
  startTime: "09:00",
  endDate: "2026-11-04",
  endTime: "10:00",
  timeZone: "UTC",
  location: "",
  description: "",
  recurrence: [],
  ...over,
});

/** [method, path, query, body] of every request */
const requests = () => googleRequest.mock.calls.map(([, method, path, query, body]) => [method, path, query, body]);

describe("request body", () => {
  it("trims text and leaves alone what the form didn't touch", () => {
    const body = draftToBody(draft({ title: " T ", location: "  Зал ", description: "\nОписание\n" }));
    expect(body).toEqual({
      summary: "T",
      location: "Зал",
      description: "Описание",
      start: { dateTime: "2026-11-04T09:00:00.000Z", timeZone: "UTC", date: null },
      end: { dateTime: "2026-11-04T10:00:00.000Z", timeZone: "UTC", date: null },
    });
  });

  it("no travel time is written as zero, not left alone", () => {
    expect(draftToBody(draft({ travelMinutes: 0 })).extendedProperties).toEqual({ private: { calmTravelMinutes: "0" } });
  });

  it("guests go without extra fields", () => {
    const guests = [
      { email: "a@x", displayName: "Аня", responseStatus: "accepted" as const, optional: true, self: true },
      { email: "b@x", optional: false },
    ];
    expect(draftToBody(draft({ guests })).attendees).toEqual([
      { email: "a@x", displayName: "Аня", responseStatus: "accepted", optional: true },
      { email: "b@x" },
    ]);
  });

  it("calendar color resets the event's color only for an existing event", () => {
    expect(draftToBody(draft({ colorId: "5" }))).toHaveProperty("colorId", "5");
    expect(draftToBody(draft({ colorId: "", id: "e" }))).toHaveProperty("colorId", null);
    expect(draftToBody(draft({ colorId: "" }))).not.toHaveProperty("colorId");
    expect(draftToBody(draft({ id: "e" }))).not.toHaveProperty("colorId");
  });

  it("a new video meeting gets a fresh request id, with or without crypto.randomUUID", () => {
    const requestId = () =>
      (draftToBody(draft({ addMeet: true })).conferenceData as { createRequest: { requestId: string; conferenceSolutionKey: unknown } })
        .createRequest;
    const first = requestId();
    expect(first.conferenceSolutionKey).toEqual({ type: "hangoutsMeet" });
    expect(first.requestId).not.toBe(requestId().requestId);
    vi.stubGlobal("crypto", { randomUUID: () => "uuid-1" });
    expect(requestId().requestId).toBe("uuid-1");
    vi.stubGlobal("crypto", {});
    expect(requestId().requestId).toMatch(/^[0-9a-z]+-[0-9a-z]+$/);
    vi.stubGlobal("crypto", undefined);
    expect(requestId().requestId).toMatch(/^[0-9a-z]+-[0-9a-z]+$/);
  });
});

describe("saving an event", () => {
  it("a new event with a rule becomes a series; guests, attachments and Meet change the query", async () => {
    const attachments = [{ fileUrl: "https://drive/1", title: "План" }];
    await saveEvent(
      draft({ recurrence: ["RRULE:FREQ=DAILY"], guests: [GUEST], addMeet: true, attachments, attachmentsChanged: true }),
    );
    const [[method, path, query, body]] = requests();
    expect([method, path, query]).toEqual(["POST", EVENTS, { conferenceDataVersion: "1", supportsAttachments: "true", sendUpdates: "all" }]);
    expect(body).toMatchObject({ recurrence: ["RRULE:FREQ=DAILY"], attachments, attendees: [GUEST] });
  });

  it("attachments are sent only when the list was changed; only our own address is not a guest", async () => {
    await saveEvent(draft({ attachments: [{ fileUrl: "https://drive/1", title: "План" }], guests: [{ email: ME, self: true }] }));
    await saveEvent(draft({ attachmentsChanged: true }));
    expect(requests().map(([, , query, body]) => [query, body])).toEqual([
      [undefined, expect.not.objectContaining({ attachments: expect.anything() })],
      [undefined, expect.not.objectContaining({ attachments: expect.anything() })],
    ]);
  });

  it("one occurrence of a series is saved by itself, without a rule", async () => {
    const occurrence = draft({ id: "s_1", recurringEventId: "s", recurrence: ["RRULE:FREQ=DAILY"] });
    await saveEvent(occurrence, "this");
    expect(requests()).toEqual([["PATCH", `${EVENTS}/s_1`, undefined, expect.not.objectContaining({ recurrence: expect.anything() })]]);
  });

  it("a regular event saved with 'following' is a regular save", async () => {
    await saveEvent(draft({ id: "e" }), "following");
    expect(requests().map(([method, path]) => [method, path])).toEqual([["PATCH", `${EVENTS}/e`]]);
  });

  it("only changed fields are sent; start and end always go together", async () => {
    const opened = draft({ id: "e" });
    const baseline = bodyBaseline(opened);
    await saveEvent({ ...opened, baseline });
    expect(googleRequest).not.toHaveBeenCalled();

    await saveEvent({ ...opened, baseline, title: "Новое" });
    await saveEvent({ ...opened, baseline, startTime: "09:30" });
    expect(requests().map(([, , , body]) => Object.keys(body as object).sort())).toEqual([["summary"], ["end", "start"]]);
  });

  it("after a move to another calendar the event is patched in its new calendar", async () => {
    await saveEvent(draft({ id: "e", originalCalendarId: PRIMARY, calendarId: calendarRef(ME, "sport"), title: "Новое" }));
    expect(requests().map(([method, path]) => [method, path])).toEqual([
      ["POST", `${EVENTS}/e/move`],
      ["PATCH", "/calendar/v3/calendars/sport/events/e"],
    ]);
  });
});

describe("quick changes without the form", () => {
  const full = {
    ...draft(),
    id: "e",
    originalCalendarId: calendarRef(ME, "old"),
    travelMinutes: 15,
    guests: [GUEST],
    attachments: [{ fileUrl: "https://drive/1", title: "План" }],
    attachmentsChanged: true,
    colorId: "3",
    addMeet: true,
  };
  const sent = async (changed: (keyof EventDraft)[]) => {
    googleRequest.mockClear();
    await patchEvent(full, changed);
    return Object.keys(requests()[0][3] as object).sort();
  };

  it("each form field sends only its own part of the event", async () => {
    const table: [keyof EventDraft, string[]][] = [
      ["title", ["summary"]],
      ["location", ["location"]],
      ["description", ["description"]],
      ["allDay", ["end", "start"]],
      ["startDate", ["end", "start"]],
      ["startTime", ["end", "start"]],
      ["endDate", ["end", "start"]],
      ["endTime", ["end", "start"]],
      ["timeZone", ["end", "start"]],
      ["endTimeZone", ["end", "start"]],
      ["travelMinutes", ["extendedProperties"]],
      ["guests", ["attendees"]],
      ["attachments", ["attachments"]],
      ["colorId", ["colorId"]],
      ["addMeet", ["conferenceData"]],
      ["recurrence", []],
    ];
    for (const [field, keys] of table) expect([field, await sent([field])]).toEqual([field, keys]);
  });

  it("goes to the calendar the event is in, with the save query", async () => {
    await patchEvent(full, ["title"]);
    expect(googleRequest).toHaveBeenCalledWith(ME, "PATCH", "/calendar/v3/calendars/old/events/e", {
      conferenceDataVersion: "1",
      supportsAttachments: "true",
      sendUpdates: "all",
    }, { summary: "Встреча" });
  });

  it("a drag sends only start and end", async () => {
    await moveEvent(full);
    expect(Object.keys(requests()[0][3] as object).sort()).toEqual(["end", "start"]);
  });
});

// weekly series on Wednesdays from November 4, 2026, 00:00 UTC; the occurrence of November 11
const master = (over: Partial<RawEvent> & Record<string, unknown> = {}): RawEvent & Record<string, unknown> => ({
  id: "s",
  start: { dateTime: "2026-11-04T00:00:00Z", timeZone: "UTC" },
  end: { dateTime: "2026-11-04T01:00:00Z", timeZone: "UTC" },
  recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"],
  ...over,
});
const occurrence = (series: RawEvent, date = "2026-11-11", over: Partial<EventDraft> = {}): EventDraft =>
  draft({
    id: `s_${date}`,
    startDate: date,
    endDate: date,
    startTime: "00:00",
    endTime: "01:00",
    recurringEventId: series.id,
    originalStart: { dateTime: `${date}T00:00:00Z` },
    recurrence: series.recurrence ?? [],
    originalRecurrence: series.recurrence,
    ...over,
  });

/** Google with this master event and these occurrences (instances) */
const google = (series: RawEvent, instances: { items?: RawEvent[]; timeZone?: string } = { items: [] }) =>
  googleRequest.mockImplementation(async (_account, method: string, path: string) => {
    if (method === "GET" && path.endsWith("/instances")) return instances;
    if (method === "GET") return series;
    return { id: "created" };
  });

describe("'this and following'", () => {
  it("from the first occurrence the whole series is patched with Meet, attachments and guest emails", async () => {
    const series = master();
    google(series);
    await saveEvent(occurrence(series, "2026-11-04", { guests: [GUEST] }), "following");
    expect(requests().slice(1).map(([method, path, query]) => [method, path, query])).toEqual([
      ["PATCH", `${EVENTS}/s`, { conferenceDataVersion: "1", supportsAttachments: "true", sendUpdates: "all" }],
    ]);
  });

  it("from the middle a new series is created and the old one is trimmed", async () => {
    const series = master();
    google(series);
    await saveEvent(occurrence(series, "2026-11-11", { originalCalendarId: PRIMARY, calendarId: calendarRef(ME, "sport") }), "following");
    expect(requests().map(([method, path, query]) => [method, path, query])).toEqual([
      ["GET", `${EVENTS}/s`, undefined],
      ["POST", EVENTS, { conferenceDataVersion: "1", supportsAttachments: "true" }],
      ["PATCH", `${EVENTS}/s`, undefined],
    ]);
    expect(requests()[2][3]).toEqual({ recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261110T235959Z"] });
  });

  it("if the old series can't be trimmed, the new one is removed and the error is shown", async () => {
    const series = master();
    const failure = { kind: "google", message: "500" };
    googleRequest.mockImplementation(async (_account, method: string) => {
      if (method === "GET") return series;
      if (method === "POST") return { id: "created" };
      if (method === "PATCH") throw failure;
      throw { kind: "network", message: "also failed" };
    });
    await expect(saveEvent(occurrence(series), "following")).rejects.toBe(failure);
    expect(requests().at(-1)?.slice(0, 2)).toEqual(["DELETE", `${EVENTS}/created`]);
  });

  it("a counted series asks Google how many occurrences already passed, deleted ones too", async () => {
    const series = master({ start: { dateTime: "2026-11-04T09:00:00" }, recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=12", "EXDATE:20261118T000000Z"] });
    google(series, {
      timeZone: "Asia/Tokyo",
      items: [
        { id: "1", start: { dateTime: "2026-11-04T09:00:00" } },
        { id: "broken" },
        { id: "moved-earlier", start: { dateTime: "2026-11-11T05:00:00" } },
        { id: "2", start: { dateTime: "2026-11-11T09:00:00" } },
      ],
    });
    await saveEvent(occurrence(series, "2026-11-11", { originalStart: { dateTime: "2026-11-11T00:00:00Z" } }), "following");
    expect(requests()[1].slice(0, 3)).toEqual(["GET", `${EVENTS}/s/instances`, { showDeleted: "true", maxResults: "2500" }]);
    expect(requests().find(([method]) => method === "POST")?.[3]).toMatchObject({
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=10", "EXDATE:20261118T000000Z"],
    });
  });

  it("an edited rule, an endless rule or an unknown occurrence time need no count", async () => {
    const series = master();
    google(series);
    await saveEvent(occurrence(series, "2026-11-11", { recurrence: ["RRULE:FREQ=DAILY;COUNT=5"] }), "following");
    const counted = master({ recurrence: ["RRULE:FREQ=DAILY;COUNT=5"] });
    google(counted);
    await saveEvent(occurrence(counted, "2026-11-11", { originalStart: undefined }), "following");
    google(series);
    await saveEvent(occurrence(series), "following");
    expect(requests().some(([, path]) => String(path).endsWith("/instances"))).toBe(false);
  });

  it("the new series copies the master's sharing settings and keeps its other hidden fields", () => {
    const shared = {
      summary: "Работа",
      description: "d",
      location: "l",
      colorId: "2",
      attachments: [{ fileUrl: "https://drive/1", title: "План" }],
      attendees: [GUEST],
      reminders: { useDefault: false },
      conferenceData: { conferenceSolution: { name: "Google Meet" } },
      visibility: "private",
      transparency: "transparent",
      guestsCanInviteOthers: false,
      guestsCanModify: true,
      guestsCanSeeOtherGuests: false,
      anyoneCanAddSelf: true,
      source: { url: "https://x" },
    };
    const series = master({ ...shared, extendedProperties: { private: { other: "1" }, shared: { s: "2" } } });
    const plan = planFollowing(occurrence(series, "2026-11-11", { travelMinutes: 10 }), series, 0);
    expect(plan.kind).toBe("split");
    if (plan.kind !== "split") return;
    const { summary: _title, description: _d, location: _l, colorId: _c, attachments: _a, attendees: _g, ...settings } = shared;
    expect(plan.create).toMatchObject(settings);
    expect(plan.create.extendedProperties).toEqual({ private: { other: "1", calmTravelMinutes: "10" }, shared: { s: "2" } });

    const untouched = planFollowing(occurrence(series), series, 0);
    expect(untouched.kind === "split" && untouched.create).toMatchObject({
      colorId: "2",
      attachments: shared.attachments,
      attendees: shared.attendees,
      extendedProperties: { private: { other: "1" }, shared: { s: "2" } },
    });

    const bare = master();
    const plain = planFollowing(occurrence(bare, "2026-11-11", { travelMinutes: 10 }), bare, 0);
    expect(plain.kind === "split" && plain.create.extendedProperties).toEqual({ private: { calmTravelMinutes: "10" } });
  });

  it("the split point is read in the series zone, not the form's", () => {
    const series = master({ start: { dateTime: "2026-11-04T09:00:00", timeZone: "Asia/Tokyo" } });
    const edited = occurrence(series, "2026-11-11", { timeZone: "Europe/London", originalStart: { dateTime: "2026-11-11T09:00:00" } });
    expect(planFollowing(edited, series, 0)).toMatchObject({
      kind: "split",
      truncate: { recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261110T235959Z"] },
    });
  });

  it("a series with only extra dates and no rule keeps its lines", () => {
    const series = master({ recurrence: ["RDATE:20261111T000000Z"] });
    expect(followingRecurrence(occurrence(series), series, 0)).toEqual(["RDATE:20261111T000000Z"]);
    const none = master({ recurrence: undefined });
    expect(followingRecurrence(occurrence(none, "2026-11-11", { originalRecurrence: [] }), none, 0)).toEqual([]);
  });
});

describe("deleting", () => {
  it("a regular event or one occurrence is deleted by itself, guests get a cancellation", async () => {
    await deleteOccurrence(draft({ id: "e", guests: [GUEST], originalCalendarId: calendarRef(ME, "old") }), "following");
    await deleteOccurrence(draft({ id: "s_1", recurringEventId: "s" }), "this");
    expect(requests()).toEqual([
      ["DELETE", "/calendar/v3/calendars/old/events/e", { sendUpdates: "all" }, undefined],
      ["DELETE", `${EVENTS}/s_1`, undefined, undefined],
    ]);
  });

  it("from the first occurrence on, the whole series is deleted", async () => {
    const series = master();
    google(series);
    await deleteOccurrence(occurrence(series, "2026-11-04"), "following");
    expect(requests().at(-1)?.slice(0, 2)).toEqual(["DELETE", `${EVENTS}/s`]);
  });

  it("from a later occurrence on, the series is trimmed", async () => {
    const series = master();
    google(series);
    await deleteOccurrence(occurrence(series, "2026-11-11"), "following");
    expect(requests().at(-1)).toEqual(["PATCH", `${EVENTS}/s`, undefined, { recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261110T235959Z"] }]);
  });
});

describe("occurrence start", () => {
  it("a regular event starts at its start", () => {
    const start = new Date(Date.UTC(2026, 10, 4, 9));
    expect(occurrenceStart({ start })).toBe(start);
  });
});

describe("invitations", () => {
  const invite = (attendees?: CalendarEvent["attendees"]): CalendarEvent => ({
    key: "k",
    id: "e",
    calendarId: PRIMARY,
    account: ME,
    title: "Созвон",
    start: new Date(),
    end: new Date(),
    allDay: false,
    recurring: false,
    organizerSelf: false,
    attendees,
  });

  it("our answer is 'not yet' until we answer", () => {
    expect(myResponse(invite([GUEST, { email: ME, self: true }]))).toBe("needsAction");
  });

  it("only our own answer goes to Google, and the guests are told", async () => {
    await respondToEvent(invite([GUEST, { email: ME, self: true, responseStatus: "needsAction" }]), "accepted");
    expect(requests()).toEqual([
      ["PATCH", `${EVENTS}/e`, { sendUpdates: "all" }, { attendeesOmitted: true, attendees: [{ email: ME, responseStatus: "accepted" }] }],
    ]);
  });

  it("without us in the guest list there is nothing to answer", async () => {
    await expect(respondToEvent(invite(), "accepted")).rejects.toEqual({ kind: "other", message: "not invited" });
    await expect(respondToEvent(invite([GUEST]), "accepted")).rejects.toEqual({ kind: "other", message: "not invited" });
    expect(googleRequest).not.toHaveBeenCalled();
    expect(withResponse(invite(), "accepted").attendees).toBeUndefined();
  });
});
