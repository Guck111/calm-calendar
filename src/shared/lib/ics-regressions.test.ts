import { describe, expect, it } from "vitest";
import { expandIcs, parseIcs } from "./ics";

const ics = (...parts: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...parts, "END:VCALENDAR"].join("\r\n");
const event = (...lines: string[]) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");
const read = (text: string, from: string, to: string) =>
  expandIcs(parseIcs(text), { start: new Date(from), end: new Date(to) }, "feed", "ics", "(untitled)");
const intervals = (text: string, from: string, to: string) =>
  read(text, from, to).map((e) => [e.start.toISOString(), e.end.toISOString()]);
const starts = (text: string, from: string, to: string) =>
  read(text, from, to).map((e) => e.start.toISOString());

describe("iCalendar recurrence and time zones", () => {
  it("1. skips a missing local recurrence without spending COUNT", () => {
    const text = ics(
      event("UID:series", "DTSTART;TZID=Europe/Warsaw:20260328T023000", "RRULE:FREQ=DAILY;COUNT=3"),
      event("UID:explicit", "DTSTART;TZID=Europe/Warsaw:20260329T023000"),
    );
    const result = read(text, "2026-03-28T00:00Z", "2026-04-02T00:00Z");
    expect.soft(result.filter((e) => e.id.startsWith("series_")).map((e) => e.start.toISOString())).toEqual([
      "2026-03-28T01:30:00.000Z", "2026-03-30T00:30:00.000Z", "2026-03-31T00:30:00.000Z",
    ]);
    expect.soft(result.find((e) => e.id.startsWith("explicit_"))?.start.toISOString()).toBe("2026-03-29T01:30:00.000Z");
  });

  it("2. applies calendar days before elapsed hours on each side of DST", () => {
    const text = ics(
      event("UID:day", "DTSTART;TZID=Europe/Warsaw:20260328T090000", "DURATION:P1D", "RRULE:FREQ=DAILY;COUNT=2"),
      event("UID:mixed", "DTSTART;TZID=Europe/Warsaw:20261024T090000", "DURATION:P1DT2H"),
      event("UID:elapsed", "DTSTART;TZID=Europe/Warsaw:20260328T090000", "DURATION:PT24H"),
    );
    const result = read(text, "2026-03-28T00:00Z", "2026-10-26T00:00Z");
    const ends = (uid: string) => result.filter((e) => e.id.startsWith(uid + "_")).map((e) => e.end.toISOString());
    expect.soft(ends("day")).toEqual(["2026-03-29T07:00:00.000Z", "2026-03-30T07:00:00.000Z"]);
    expect.soft(ends("mixed")).toEqual(["2026-10-25T10:00:00.000Z"]);
    expect.soft(ends("elapsed")).toEqual(["2026-03-29T08:00:00.000Z"]);
  });

  it("3. uses an embedded TZID and its recurring STANDARD and DAYLIGHT transitions", () => {
    const zone = [
      "BEGIN:VTIMEZONE", "TZID:Calendar Workshop",
      "BEGIN:DAYLIGHT", "DTSTART:20200329T020000", "TZOFFSETFROM:+0530", "TZOFFSETTO:+0630",
      "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
      "BEGIN:STANDARD", "DTSTART:20201025T030000", "TZOFFSETFROM:+0630", "TZOFFSETTO:+0530",
      "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD",
      "END:VTIMEZONE",
    ].join("\r\n");
    const text = ics(
      event("UID:shift", "DTSTART;TZID=Calendar Workshop:20260328T023000", "RRULE:FREQ=DAILY;COUNT=3"),
      event("UID:fall", "DTSTART;TZID=Calendar Workshop:20261025T090000", "DTEND;TZID=Calendar Workshop:20261025T100000"),
      zone,
    );
    expect(intervals(text, "2026-03-27T00:00Z", "2026-10-26T00:00Z")).toEqual([
      ["2026-03-27T21:00:00.000Z", "2026-03-27T21:00:00.000Z"],
      ["2026-03-29T20:00:00.000Z", "2026-03-29T20:00:00.000Z"],
      ["2026-03-30T20:00:00.000Z", "2026-03-30T20:00:00.000Z"],
      ["2026-10-25T03:30:00.000Z", "2026-10-25T04:30:00.000Z"],
    ]);
  });

  it("4. expands YEARLY with BYMONTHDAY through the months of the year", () => {
    const text = ics(event("UID:annual", "DTSTART:20260110T090000Z", "RRULE:FREQ=YEARLY;BYMONTHDAY=10;COUNT=3"));
    expect(starts(text, "2026-01-01T00:00Z", "2029-01-01T00:00Z")).toEqual([
      "2026-01-10T09:00:00.000Z", "2026-02-10T09:00:00.000Z", "2026-03-10T09:00:00.000Z",
    ]);
  });

  it("5. retains RDATE periods and applies range edits without overriding individual exceptions", () => {
    const periods = ics(event(
      "UID:periods", "DTSTART:20261109T090000Z", "DURATION:PT1H", "RRULE:FREQ=DAILY;COUNT=2",
      "RDATE;VALUE=PERIOD:20261110T090000Z/20261110T120000Z,20261112T110000Z/PT2H,20261113T110000Z/PT2H",
      "EXDATE:20261113T110000Z",
    ));
    expect.soft(intervals(periods, "2026-11-08T00:00Z", "2026-11-14T00:00Z")).toEqual([
      ["2026-11-09T09:00:00.000Z", "2026-11-09T10:00:00.000Z"],
      ["2026-11-10T09:00:00.000Z", "2026-11-10T12:00:00.000Z"],
      ["2026-11-12T11:00:00.000Z", "2026-11-12T13:00:00.000Z"],
    ]);

    const ranged = ics(
      event("UID:range", "DTSTART:20261109T090000Z", "DURATION:PT1H", "RRULE:FREQ=DAILY;COUNT=5"),
      event("UID:range", "RECURRENCE-ID;RANGE=THISANDFUTURE:20261110T090000Z", "DTSTART:20261110T110000Z", "DURATION:PT90M"),
      event("UID:range", "RECURRENCE-ID:20261112T090000Z", "DTSTART:20261112T160000Z", "DURATION:PT30M"),
    );
    expect.soft(intervals(ranged, "2026-11-09T00:00Z", "2026-11-14T00:00Z")).toEqual([
      ["2026-11-09T09:00:00.000Z", "2026-11-09T10:00:00.000Z"],
      ["2026-11-10T11:00:00.000Z", "2026-11-10T12:30:00.000Z"],
      ["2026-11-11T11:00:00.000Z", "2026-11-11T12:30:00.000Z"],
      ["2026-11-12T16:00:00.000Z", "2026-11-12T16:30:00.000Z"],
      ["2026-11-13T11:00:00.000Z", "2026-11-13T12:30:00.000Z"],
    ]);

    const movedIntoWindow = ics(
      event("UID:shift", "DTSTART:20261101T090000Z", "RRULE:FREQ=DAILY;COUNT=3"),
      event("UID:shift", "RECURRENCE-ID;RANGE=THISANDFUTURE:20261101T090000Z", "DTSTART:20261111T090000Z"),
    );
    expect.soft(starts(movedIntoWindow, "2026-11-13T00:00Z", "2026-11-14T00:00Z"))
      .toEqual(["2026-11-13T09:00:00.000Z"]);
  });

  it("6. counts old occurrences without exhausting the output limit before the window", () => {
    const text = ics(event("UID:long", "DTSTART:20100101T090000Z", "RRULE:FREQ=DAILY;COUNT=10000"));
    expect.soft(starts(text, "2026-11-11T00:00Z", "2026-11-14T00:00Z")).toEqual([
      "2026-11-11T09:00:00.000Z", "2026-11-12T09:00:00.000Z", "2026-11-13T09:00:00.000Z",
    ]);
    const day = 86_400_000;
    const last = new Date(Date.UTC(2010, 0, 1, 9) + 9999 * day);
    expect.soft(starts(text, last.toISOString(), new Date(+last + 2 * day).toISOString())).toEqual([last.toISOString()]);
  });
});
