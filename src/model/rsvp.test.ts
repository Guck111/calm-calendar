// Ответ на приглашение: пойду, не пойду, может быть — в карточке чужой встречи
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

describe("ответ на приглашение", () => {
  it("свой ответ есть только у приглашённого на чужую встречу", () => {
    expect(myResponse(invite())).toBe("needsAction");
    expect(myResponse(invite({ organizer: { email: ME, self: true } }))).toBeUndefined();
    expect(myResponse(invite({ attendees: undefined }))).toBeUndefined();
  });

  it("в Google уходит только свой ответ, с письмом организатору", async () => {
    await respondToEvent(invite(), "accepted");
    const [account, method, path, query, body] = googleRequest.mock.calls[0];
    expect([account, method]).toEqual([ME, "PATCH"]);
    expect(path).toBe("/calendar/v3/calendars/work/events/q1_20261110T150000Z");
    expect(query).toEqual({ sendUpdates: "all" });
    // attendeesOmitted: остальных гостей не трогаем, даже если Google прислал не весь список
    expect(body).toEqual({
      attendeesOmitted: true,
      attendees: [{ email: "me.alias@example.com", responseStatus: "accepted" }],
    });
  });

  it("после ответа карточка сразу показывает новый ответ", async () => {
    const scope = fork();
    await allSettled(eventOpened, { scope, params: invite() });
    await allSettled(rsvpClicked, { scope, params: "declined" });
    const opened = scope.getState($opened);
    expect(opened && myResponse(opened)).toBe("declined");
    expect(opened?.attendees?.find((a) => a.email === "anna@example.com")?.responseStatus).toBe("tentative");
  });
});
