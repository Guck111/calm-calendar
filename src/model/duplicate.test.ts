// Event copy: new event form with the original's fields
import { allSettled, fork } from "effector";
import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "../shared/api/types";
import { toCalendarEvent } from "../shared/api/calendar";
import { $draft, $mode, $opened, duplicateClicked, duplicateDraft, eventOpened } from "./editor";

const MINE = "me@example.com\u0000primary";
const HOLIDAYS = "me@example.com\u0000pl#holiday";

const event = (over: Record<string, unknown> = {}, calendarId = MINE): CalendarEvent =>
  toCalendarEvent(
    calendarId,
    {
      id: "e1",
      summary: "Стоматолог",
      location: "Гдыня",
      description: "Взять снимок",
      start: { dateTime: "2026-11-11T16:00:00+01:00", timeZone: "Europe/Warsaw" },
      end: { dateTime: "2026-11-11T16:45:00+01:00", timeZone: "Europe/Warsaw" },
      extendedProperties: { private: { calmTravelMinutes: "30" } },
      hangoutLink: "https://meet.google.com/abc-defg-hij",
      organizer: { email: "me@example.com", self: true },
      attendees: [
        { email: "me@example.com", self: true, organizer: true, responseStatus: "accepted" },
        { email: "anna@example.com", displayName: "Анна", responseStatus: "accepted" },
      ],
      ...over,
    },
  ) as CalendarEvent;

describe("event copy", () => {
  it("new event with the same fields, without id, guest responses and the old video meeting", () => {
    const d = duplicateDraft(event(), [MINE]);
    expect(d.id).toBeUndefined();
    expect(d.originalCalendarId).toBeUndefined();
    expect(d).toMatchObject({
      calendarId: MINE,
      title: "Стоматолог",
      location: "Гдыня",
      description: "Взять снимок",
      startDate: "2026-11-11",
      startTime: "16:00",
      endTime: "16:45",
      timeZone: "Europe/Warsaw",
      travelMinutes: 30,
      recurrence: [],
      addMeet: false,
    });
    // the account itself becomes the organizer of the copy; other guests' responses start over
    expect(d.guests).toEqual([{ email: "anna@example.com", displayName: "Анна" }]);
  });

  it("an occurrence of a series is copied as a single event", () => {
    const d = duplicateDraft(event({ recurringEventId: "s1", originalStartTime: { dateTime: "2026-11-11T15:00:00Z" } }), [MINE]);
    expect(d.recurringEventId).toBeUndefined();
    expect(d.originalStart).toBeUndefined();
    expect(d.recurrence).toEqual([]);
  });

  it("an event from a read-only calendar is copied into the first own calendar", () => {
    const d = duplicateDraft(event({}, HOLIDAYS), [MINE]);
    expect(d.calendarId).toBe(MINE);
  });

  it("from the card: 'Duplicate' opens the new event form", async () => {
    const scope = fork();
    await allSettled(eventOpened, { scope, params: event() });
    await allSettled(duplicateClicked, { scope });
    expect(scope.getState($mode)).toBe("edit");
    expect(scope.getState($opened)).toBeNull();
    expect(scope.getState($draft)?.id).toBeUndefined();
    expect(scope.getState($draft)?.title).toBe("Стоматолог");
  });
});
