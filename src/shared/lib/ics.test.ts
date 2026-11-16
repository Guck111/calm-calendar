import { describe, expect, it } from "vitest";
import { expandIcs, parseDuration, parseIcs, zoneOf } from "./ics";

const CAL = "cal";
const ics = (...events: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", "X-WR-CALNAME:Schedule", ...events, "END:VCALENDAR"].join("\r\n");
const vevent = (...lines: string[]) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");

/** events in a range, as the calendar will see them */
const expand = (text: string, from: string, to: string) =>
  expandIcs(parseIcs(text), { start: new Date(from), end: new Date(to) }, CAL, "ics", "(untitled)");

const starts = (text: string, from: string, to: string) => expand(text, from, to).map((e) => e.start.toISOString());

describe(".ics calendar: parsing", () => {
  it("calendar name, event with time zone, text with line breaks and escaping", () => {
    const text = ics(
      vevent(
        "UID:1@x",
        'DTSTART;TZID="Europe/Berlin":20261111T090000',
        "DTEND;TZID=Europe/Berlin:20261111T103000",
        "SUMMARY:Team\\, weekly",
        "LOCATION:Room 4\\; floor 2",
        "DESCRIPTION:Line one\\nLine two",
      ),
    );
    const [e] = expand(text, "2026-11-11T00:00:00Z", "2026-11-12T00:00:00Z");
    expect(parseIcs(text).name).toBe("Schedule");
    expect(e.title).toBe("Team, weekly");
    expect(e.location).toBe("Room 4; floor 2");
    expect(e.description).toBe("Line one\nLine two");
    expect(e.start.toISOString()).toBe("2026-11-11T08:00:00.000Z");
    expect(e.end.toISOString()).toBe("2026-11-11T09:30:00.000Z");
    expect(e.timeZone).toBe("Europe/Berlin");
    expect(e.allDay).toBe(false);
  });

  it("a long line folded with a space is joined", () => {
    const text = ics(vevent("UID:2", "DTSTART:20261111T090000Z", "SUMMARY:A very long ti", " tle that was folded"));
    expect(expand(text, "2026-11-11T00:00:00Z", "2026-11-12T00:00:00Z")[0].title).toBe("A very long title that was folded");
  });

  it("all-day event: end is exclusive, without DTEND — one day", () => {
    const text = ics(
      vevent("UID:3", "DTSTART;VALUE=DATE:20261111", "DTEND;VALUE=DATE:20261113", "SUMMARY:Trip"),
      vevent("UID:4", "DTSTART;VALUE=DATE:20261120", "SUMMARY:Holiday"),
    );
    const [trip, holiday] = expand(text, "2026-11-01T00:00:00", "2026-12-01T00:00:00");
    expect(trip.allDay).toBe(true);
    expect(trip.start).toEqual(new Date(2026, 10, 11));
    expect(trip.end).toEqual(new Date(2026, 10, 13));
    expect(holiday.end).toEqual(new Date(2026, 10, 21));
  });

  it("DURATION instead of DTEND", () => {
    const text = ics(vevent("UID:5", "DTSTART:20261111T090000Z", "DURATION:PT1H30M"));
    const [e] = expand(text, "2026-11-11T00:00:00Z", "2026-11-12T00:00:00Z");
    expect(e.end.toISOString()).toBe("2026-11-11T10:30:00.000Z");
    expect(parseDuration("P1W")).toBe(7 * 86_400_000);
    expect(parseDuration("-PT15M")).toBe(-15 * 60_000);
    expect(parseDuration("P")).toBeNull();
  });

  it("Outlook (Windows) and prefixed time zones are recognized, an unknown time zone uses the computer clock", () => {
    expect(zoneOf("W. Europe Standard Time")).toBe("Europe/Berlin");
    expect(zoneOf("/mozilla.org/20050126_1/Europe/Paris")).toBe("Europe/Paris");
    expect(zoneOf("Mars Standard Time")).toBeUndefined();
    const text = ics(vevent("UID:6", "DTSTART;TZID=Mars Standard Time:20261111T090000"));
    const [e] = expand(text, "2026-11-10T00:00:00", "2026-11-13T00:00:00");
    expect(e.start).toEqual(new Date(2026, 10, 11, 9, 0));
  });

  it("cancelled events and reminders inside an event don't get in the way", () => {
    const text = ics(
      vevent("UID:7", "DTSTART:20261111T090000Z", "STATUS:CANCELLED", "SUMMARY:Gone"),
      vevent("UID:8", "DTSTART:20261111T100000Z", "SUMMARY:Kept", "BEGIN:VALARM", "TRIGGER:-PT15M", "SUMMARY:Alarm", "END:VALARM"),
    );
    expect(expand(text, "2026-11-11T00:00:00Z", "2026-11-12T00:00:00Z").map((e) => e.title)).toEqual(["Kept"]);
  });

  it("free time, video meeting link in the description, untitled event", () => {
    const text = ics(
      vevent("UID:9", "DTSTART:20261111T090000Z", "TRANSP:TRANSPARENT", "DESCRIPTION:Join https://zoom.us/j/123"),
    );
    const [e] = expand(text, "2026-11-11T00:00:00Z", "2026-11-12T00:00:00Z");
    expect(e.free).toBe(true);
    expect(e.meeting?.url).toBe("https://zoom.us/j/123");
    expect(e.title).toBe("(untitled)");
  });

  it("garbage instead of a calendar is an empty list, not an error", () => {
    expect(parseIcs("<html>Not found</html>").events).toEqual([]);
  });
});

describe(".ics calendar: recurrences", () => {
  it("weekly on Tuesdays and Thursdays until COUNT runs out", () => {
    const text = ics(vevent("UID:w", "DTSTART:20261110T170000Z", "DURATION:PT1H", "RRULE:FREQ=WEEKLY;BYDAY=TU,TH;COUNT=4"));
    expect(starts(text, "2026-11-01T00:00:00Z", "2026-12-31T00:00:00Z")).toEqual([
      "2026-11-10T17:00:00.000Z",
      "2026-11-12T17:00:00.000Z",
      "2026-11-17T17:00:00.000Z",
      "2026-11-19T17:00:00.000Z",
    ]);
  });

  it("every other week: INTERVAL", () => {
    const text = ics(vevent("UID:i", "DTSTART:20261102T080000Z", "RRULE:FREQ=WEEKLY;INTERVAL=2"));
    expect(starts(text, "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z")).toEqual([
      "2026-11-02T08:00:00.000Z",
      "2026-11-16T08:00:00.000Z",
      "2026-11-30T08:00:00.000Z",
    ]);
  });

  it("second Tuesday and last Friday of the month", () => {
    const second = ics(vevent("UID:m", "DTSTART:20261110T090000Z", "RRULE:FREQ=MONTHLY;BYDAY=2TU"));
    expect(starts(second, "2026-11-01T00:00:00Z", "2027-02-01T00:00:00Z")).toEqual([
      "2026-11-10T09:00:00.000Z",
      "2026-12-08T09:00:00.000Z",
      "2027-01-12T09:00:00.000Z",
    ]);
    const last = ics(vevent("UID:l", "DTSTART:20261127T090000Z", "RRULE:FREQ=MONTHLY;BYDAY=-1FR"));
    expect(starts(last, "2026-11-01T00:00:00Z", "2027-02-01T00:00:00Z")).toEqual([
      "2026-11-27T09:00:00.000Z",
      "2026-12-25T09:00:00.000Z",
      "2027-01-29T09:00:00.000Z",
    ]);
  });

  it("last day of the month and a yearly birthday", () => {
    const monthEnd = ics(vevent("UID:e", "DTSTART;VALUE=DATE:20261130", "RRULE:FREQ=MONTHLY;BYMONTHDAY=-1"));
    expect(expand(monthEnd, "2026-11-01T00:00:00", "2027-03-01T00:00:00").map((e) => e.start)).toEqual([
      new Date(2026, 10, 30),
      new Date(2026, 11, 31),
      new Date(2027, 0, 31),
      new Date(2027, 1, 28),
    ]);
    const birthday = ics(vevent("UID:b", "DTSTART;VALUE=DATE:19900315", "RRULE:FREQ=YEARLY"));
    expect(expand(birthday, "2026-01-01T00:00:00", "2028-01-01T00:00:00").map((e) => e.start)).toEqual([
      new Date(2026, 2, 15),
      new Date(2027, 2, 15),
    ]);
  });

  it("UNTIL includes the last day, EXDATE removes an occurrence", () => {
    const text = ics(
      vevent(
        "UID:u",
        "DTSTART;TZID=Europe/Warsaw:20261109T090000",
        "RRULE:FREQ=DAILY;UNTIL=20261113T080000Z",
        "EXDATE;TZID=Europe/Warsaw:20261111T090000",
      ),
    );
    expect(starts(text, "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z")).toEqual([
      "2026-11-09T08:00:00.000Z",
      "2026-11-10T08:00:00.000Z",
      "2026-11-12T08:00:00.000Z",
      "2026-11-13T08:00:00.000Z",
    ]);
  });

  it("wall clock time in the time zone is kept across the switch to winter time", () => {
    const text = ics(vevent("UID:dst", "DTSTART;TZID=Europe/Berlin:20261023T090000", "RRULE:FREQ=WEEKLY"));
    expect(starts(text, "2026-10-20T00:00:00Z", "2026-11-05T00:00:00Z")).toEqual([
      "2026-10-23T07:00:00.000Z",
      "2026-10-30T08:00:00.000Z",
    ]);
  });

  it("a moved occurrence is shown in its new place, not the old one", () => {
    const text = ics(
      vevent("UID:r", "DTSTART:20261109T090000Z", "SUMMARY:Standup", "RRULE:FREQ=DAILY;COUNT=3"),
      vevent("UID:r", "RECURRENCE-ID:20261110T090000Z", "DTSTART:20261110T150000Z", "SUMMARY:Standup (moved)"),
    );
    expect(expand(text, "2026-11-09T00:00:00Z", "2026-11-12T00:00:00Z").map((e) => `${e.title} ${e.start.toISOString()}`)).toEqual([
      "Standup 2026-11-09T09:00:00.000Z",
      "Standup (moved) 2026-11-10T15:00:00.000Z",
      "Standup 2026-11-11T09:00:00.000Z",
    ]);
  });

  it("RDATE adds days outside the rule, and a repeat of the same day doesn't duplicate", () => {
    const text = ics(
      vevent("UID:rd", "DTSTART:20261102T090000Z", "RRULE:FREQ=WEEKLY;COUNT=2", "RDATE:20261105T090000Z,20261109T090000Z"),
    );
    expect(starts(text, "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z")).toEqual([
      "2026-11-02T09:00:00.000Z",
      "2026-11-05T09:00:00.000Z",
      "2026-11-09T09:00:00.000Z",
    ]);
  });

  it("BYMONTH: last Sunday of March and October (clock change in Europe)", () => {
    const text = ics(vevent("UID:bm", "DTSTART;VALUE=DATE:20260329", "RRULE:FREQ=YEARLY;BYMONTH=3,10;BYDAY=-1SU"));
    expect(expand(text, "2026-01-01T00:00:00", "2028-01-01T00:00:00").map((e) => e.start)).toEqual([
      new Date(2026, 2, 29),
      new Date(2026, 9, 25),
      new Date(2027, 2, 28),
      new Date(2027, 9, 31),
    ]);
  });

  it("an old endless series is expanded only for the shown days", () => {
    const text = ics(vevent("UID:old", "DTSTART:20050103T090000Z", "RRULE:FREQ=DAILY"));
    expect(starts(text, "2026-11-11T00:00:00Z", "2026-11-13T00:00:00Z")).toEqual([
      "2026-11-11T09:00:00.000Z",
      "2026-11-12T09:00:00.000Z",
    ]);
  });

  it("a rule we can't expand leaves only the first event", () => {
    const text = ics(vevent("UID:p", "DTSTART:20261102T090000Z", "RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1"));
    expect(starts(text, "2026-11-01T00:00:00Z", "2027-02-01T00:00:00Z")).toEqual(["2026-11-02T09:00:00.000Z"]);
  });

  it("subscription events are read-only and not linked to Google", () => {
    const [e] = expand(ics(vevent("UID:z", "DTSTART:20261111T090000Z")), "2026-11-11T00:00:00Z", "2026-11-12T00:00:00Z");
    expect(e.calendarId).toBe(CAL);
    expect(e.recurring).toBe(false);
    expect(e.organizerSelf).toBe(false);
    expect(e.htmlLink).toBeUndefined();
  });
});
