// Invitation response: yes, no, maybe — in the card of someone else's meeting
import { allSettled, fork } from "effector";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "../shared/api/types";

const googleRequest = vi.fn();
vi.mock(import("../shared/api/bridge"), async (importOriginal) => ({
  ...(await importOriginal()),
  googleRequest: (...args: unknown[]) => googleRequest(...args),
}));

const { myResponse, respondToEvent, toCalendarEvent } = await import("../shared/api/calendar");
const { $opened, eventOpened, rsvpClicked } = await import("./editor");

beforeEach(() => {
  googleRequest.mockReset();
  googleRequest.mockResolvedValue({});
});

const ME = "work@example.com";
const CAL = `${ME}\u0000work`;

const invite = (over: Record<string, unknown> = {}): CalendarEvent =>
  toCalendarEvent(CAL, {
    id: "q1_20261110T150000Z",
    summary: "Квартальное планирование",
    start: { dateTime: "2026-11-10T16:00:00+01:00" },
    end: { dateTime: "2026-11-10T17:00:00+01:00" },
    organizer: { email: "boss@example.com" },
    attendees: [
      { email: "boss@example.com", organizer: true, responseStatus: "accepted" },
      { email: "me.alias@example.com", self: true, responseStatus: "needsAction" },
      { email: "anna@example.com", responseStatus: "tentative" },
    ],
    ...over,
  }) as CalendarEvent;

describe("invitation response", () => {
  it("only a guest invited to someone else's meeting has their own response", () => {
    expect(myResponse(invite())).toBe("needsAction");
    expect(myResponse(invite({ organizer: { email: ME, self: true } }))).toBeUndefined();
    expect(myResponse(invite({ attendees: undefined }))).toBeUndefined();
  });

  it("only the own response goes to Google, with an email to the organizer", async () => {
    await respondToEvent(invite(), "accepted");
    const [account, method, path, query, body] = googleRequest.mock.calls[0];
    expect([account, method]).toEqual([ME, "PATCH"]);
    expect(path).toBe("/calendar/v3/calendars/work/events/q1_20261110T150000Z");
    expect(query).toEqual({ sendUpdates: "all" });
    // attendeesOmitted: other guests are left alone, even if Google sent an incomplete list
    expect(body).toEqual({
      attendeesOmitted: true,
      attendees: [{ email: "me.alias@example.com", responseStatus: "accepted" }],
    });
  });

  it("after responding, the card shows the new response right away", async () => {
    const scope = fork();
    await allSettled(eventOpened, { scope, params: invite() });
    await allSettled(rsvpClicked, { scope, params: "declined" });
    const opened = scope.getState($opened);
    expect(opened && myResponse(opened)).toBe("declined");
    expect(opened?.attendees?.find((a) => a.email === "anna@example.com")?.responseStatus).toBe("tentative");
  });
});
