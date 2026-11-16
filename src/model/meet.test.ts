// "Add Google Meet": request to create a video meeting when saving the event
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent, EventDraft } from "../shared/api/types";

const googleRequest = vi.fn();
vi.mock(import("../shared/api/bridge"), async (importOriginal) => ({
  ...(await importOriginal()),
  googleRequest: (...args: unknown[]) => googleRequest(...args),
}));

const { draftToBody, saveEvent, toCalendarEvent } = await import("../shared/api/calendar");
const { fromEvent } = await import("./editor");

beforeEach(() => {
  googleRequest.mockReset();
  googleRequest.mockResolvedValue({});
});

const CAL = "me@example.com\u0000primary";

const draft = (over: Partial<EventDraft> = {}): EventDraft => ({
  calendarId: CAL,
  title: "Созвон",
  allDay: false,
  startDate: "2026-11-12",
  startTime: "10:00",
  endDate: "2026-11-12",
  endTime: "11:00",
  location: "",
  description: "",
  recurrence: [],
  ...over,
});

const call = (method: string) => googleRequest.mock.calls.find((c) => c[1] === method);

describe("Google Meet on create", () => {
  it("with the checkbox, the request body has a Meet request with a unique requestId", () => {
    const a = draftToBody(draft({ addMeet: true }));
    const b = draftToBody(draft({ addMeet: true }));
    expect(a.conferenceData).toEqual({
      createRequest: { requestId: expect.any(String), conferenceSolutionKey: { type: "hangoutsMeet" } },
    });
    expect(a.conferenceData?.createRequest.requestId).not.toBe(b.conferenceData?.createRequest.requestId);
  });

  it("without the checkbox the video meeting is left alone", () => {
    expect(draftToBody(draft())).not.toHaveProperty("conferenceData");
    expect(draftToBody(draft({ addMeet: false }))).not.toHaveProperty("conferenceData");
  });

  it("new event with Meet: conferenceDataVersion=1, without it Google won't accept the request", async () => {
    await saveEvent(draft({ addMeet: true }));
    const [, , , query, body] = call("POST") ?? [];
    expect(query).toMatchObject({ conferenceDataVersion: "1" });
    expect(body.conferenceData.createRequest.conferenceSolutionKey.type).toBe("hangoutsMeet");
  });

  it("Meet can be added to an existing event too", async () => {
    await saveEvent(draft({ id: "e1", originalCalendarId: CAL, addMeet: true }));
    const [, , , query, body] = call("PATCH") ?? [];
    expect(query).toMatchObject({ conferenceDataVersion: "1" });
    expect(body).toHaveProperty("conferenceData.createRequest");
  });

  it("an event with a video meeting has no checkbox, an event without one has it off", () => {
    const withMeet = toCalendarEvent(CAL, {
      id: "1",
      summary: "a",
      start: { dateTime: "2026-11-12T10:00:00Z" },
      end: { dateTime: "2026-11-12T11:00:00Z" },
      hangoutLink: "https://meet.google.com/abc-defg-hij",
    }) as CalendarEvent;
    const plain = toCalendarEvent(CAL, {
      id: "2",
      summary: "b",
      start: { dateTime: "2026-11-12T10:00:00Z" },
      end: { dateTime: "2026-11-12T11:00:00Z" },
    }) as CalendarEvent;
    expect(fromEvent(withMeet).addMeet).toBeUndefined();
    expect(fromEvent(plain).addMeet).toBe(false);
  });
});
