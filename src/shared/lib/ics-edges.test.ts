import { describe, expect, it } from "vitest";
import { expandIcs, parseDuration, parseIcs, parseRule, parseTime, zoneOf } from "./ics";

const ics = (...parts: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", "X-WR-CALNAME:Schedule", ...parts, "END:VCALENDAR"].join("\r\n");
const vevent = (...lines: string[]) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");
const vtimezone = (id: string, ...observances: string[][]) =>
  ["BEGIN:VTIMEZONE", `TZID:${id}`, ...observances.flat(), "END:VTIMEZONE"].join("\r\n");
const observance = (kind: "STANDARD" | "DAYLIGHT", ...lines: string[]) => [`BEGIN:${kind}`, ...lines, `END:${kind}`];
const fixedOffset = (offset: string) =>
  observance("STANDARD", "DTSTART:19700101T000000", `TZOFFSETFROM:${offset}`, `TZOFFSETTO:${offset}`);

const read = (text: string, from: string, to: string) =>
  expandIcs(parseIcs(text), { start: new Date(from), end: new Date(to) }, "cal", "ics", "(untitled)");
const starts = (text: string, from: string, to: string) => read(text, from, to).map((e) => e.start.toISOString());
const intervals = (text: string, from: string, to: string) =>
  read(text, from, to).map((e) => `${e.start.toISOString()} ${e.end.toISOString()}`);
const only = (text: string) => {
  const events = read(text, "2026-01-01T00:00:00Z", "2027-01-01T00:00:00Z");
  expect(events).toHaveLength(1);
  return events[0];
};
const dates = (text: string, from: string, to: string) =>
  read(text, from, to).map((e) => e.start.toISOString().slice(0, 10));

describe(".ics lines and text", () => {
  it("accepts lone CR line endings and lines folded with a tab", () => {
    const text = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:cr", "DTSTART:20261111T090000Z", "SUMMARY:Folded", "\tby tab", "END:VEVENT", "END:VCALENDAR"]
      .join("\r");
    expect(only(text).title).toBe("Foldedby tab");
  });

  it("a colon or semicolon inside a quoted parameter does not split the line", () => {
    const e = only(ics(vevent(
      "UID:q",
      'DTSTART;TZID=Europe/Berlin;X-NOTE="see;TZID=Asia/Tokyo":20261111T090000',
      'LOCATION;ALTREP="https://maps.example/a:b":Room 4',
    )));
    expect(e.start.toISOString()).toBe("2026-11-11T08:00:00.000Z");
    expect(e.location).toBe("Room 4");
  });

  it("a line without a colon is ignored", () => {
    expect(only(ics(vevent("UID:nc", "DTSTART:20261111T090000Z", "SUMMARY:Kept", "SUMMARYX"))).title).toBe("Kept");
  });

  it("an escaped capital N is a line break too", () => {
    expect(only(ics(vevent("UID:n", "DTSTART:20261111T090000Z", "DESCRIPTION:One\\NTwo"))).description).toBe("One\nTwo");
  });

  it("spaces around values are trimmed", () => {
    const e = only(ics(vevent(
      "UID: a1 ", "DTSTART:20261111T090000Z", "SUMMARY:  Team  ", "LOCATION:  Room  ", "DESCRIPTION:  Notes  ",
    )));
    expect(e.id.startsWith("a1_")).toBe(true);
    expect([e.title, e.location, e.description]).toEqual(["Team", "Room", "Notes"]);
  });

  it("the calendar name is trimmed, a blank one is no name, and other calendar lines do not replace it", () => {
    const named = ["BEGIN:VCALENDAR", "X-WR-CALNAME:  Team days  ", "PRODID:-//Example//EN", "END:VCALENDAR"].join("\r\n");
    expect(parseIcs(named).name).toBe("Team days");
    expect(parseIcs(["BEGIN:VCALENDAR", "X-WR-CALNAME:   ", "END:VCALENDAR"].join("\r\n")).name).toBeUndefined();
  });

  it("STATUS and TRANSP are read with spaces around them, other values keep the event busy and shown", () => {
    const text = ics(
      vevent("UID:c", "DTSTART:20261111T090000Z", "STATUS: CANCELLED "),
      vevent("UID:k", "DTSTART:20261111T100000Z", "STATUS:CONFIRMED", "TRANSP:OPAQUE"),
      vevent("UID:f", "DTSTART:20261111T110000Z", "TRANSP: TRANSPARENT "),
    );
    expect(read(text, "2026-11-11T00:00:00Z", "2026-11-12T00:00:00Z").map((e) => [e.id.split("_")[0], e.free])).toEqual([
      ["k", false],
      ["f", true],
    ]);
  });

  it("an RRULE with spaces around it is still expanded", () => {
    expect(starts(ics(vevent("UID:r", "DTSTART:20261111T090000Z", "RRULE: FREQ=DAILY;COUNT=2 ")), "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z"))
      .toEqual(["2026-11-11T09:00:00.000Z", "2026-11-12T09:00:00.000Z"]);
  });
});

describe(".ics event blocks", () => {
  it("lines after a reminder block still belong to the event", () => {
    const e = only(ics(vevent("UID:a", "DTSTART:20261111T090000Z", "BEGIN:VALARM", "TRIGGER:-PT15M", "END:VALARM", "SUMMARY:After alarm")));
    expect(e.title).toBe("After alarm");
  });

  it("stray END lines do not break or end events", () => {
    const text = ics("END:VEVENT", vevent("UID:s", "DTSTART:20261111T090000Z", "END:X-NOTE", "SUMMARY:Whole"));
    expect(only(text).title).toBe("Whole");
  });

  it("an event without DTSTART or without a UID line is skipped, an empty UID gets one made up", () => {
    const text = ics(
      vevent("UID:no-start", "SUMMARY:No start"),
      vevent("DTSTART:20261111T090000Z", "SUMMARY:No uid"),
      vevent("UID:", "DTSTART:20261111T100000Z", "SUMMARY:Lunch"),
    );
    expect(parseIcs(text).events.map((e) => e.uid)).toEqual(["Lunch@20261111"]);
    expect(only(text).id.startsWith("Lunch@20261111_")).toBe(true);
  });

  it("an unreadable DURATION leaves a zero-length event", () => {
    const e = only(ics(vevent("UID:d", "DTSTART:20261111T090000Z", "DURATION:nonsense")));
    expect(e.end).toEqual(e.start);
  });

  it("an all-day event with DURATION in days lasts those days", () => {
    const e = only(ics(vevent("UID:ad", "DTSTART;VALUE=DATE:20261111", "DURATION:P3D")));
    expect(e.end).toEqual(new Date(2026, 10, 14));
  });

  it("seconds of the start time are kept", () => {
    expect(only(ics(vevent("UID:s", "DTSTART:20261111T090045Z"))).start.toISOString()).toBe("2026-11-11T09:00:45.000Z");
  });

  it("RDATE periods that are malformed, all-day or not longer than zero are ignored", () => {
    const text = ics(vevent(
      "UID:p", "DTSTART:20261109T090000Z",
      "RDATE;VALUE=PERIOD:20261110T090000Z/PT1H/PT2H,20261111T090000Z,20261112/PT1H",
      "RDATE;VALUE=PERIOD:20261113T090000Z/20261113T080000Z,20261114T090000Z/PT0S,20261115T090000Z/PT1H",
    ));
    expect(intervals(text, "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z")).toEqual([
      "2026-11-09T09:00:00.000Z 2026-11-09T09:00:00.000Z",
      "2026-11-15T09:00:00.000Z 2026-11-15T10:00:00.000Z",
    ]);
  });

  it("an event in the shown range has a calendar key, default reminders and no time zone when written in UTC", () => {
    const e = only(ics(vevent("UID:u", "DTSTART:20261111T090000Z")));
    expect(e.key).toBe(`cal\u0000${e.id}`);
    expect(e.reminders).toBe("default");
    expect(e.free).toBe(false);
    expect(e).not.toHaveProperty("timeZone");
  });

  it("all-day occurrences get ids by date", () => {
    const text = ics(vevent("UID:b", "DTSTART;VALUE=DATE:20261102", "RRULE:FREQ=WEEKLY;COUNT=2"));
    expect(read(text, "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z").map((e) => e.id)).toEqual(["b_2026-11-2", "b_2026-11-9"]);
  });

  it("only events touching the range are returned", () => {
    const text = ics(
      vevent("UID:before", "DTSTART:20261111T080000Z", "DTEND:20261111T090000Z"),
      vevent("UID:across", "DTSTART:20261111T080000Z", "DTEND:20261111T100000Z"),
    );
    expect(read(text, "2026-11-11T09:00:00Z", "2026-11-12T00:00:00Z").map((e) => e.id.split("_")[0])).toEqual(["across"]);
  });
});

describe(".ics time values", () => {
  it("reads dates, times without seconds, seconds and a leap second, with spaces around", () => {
    expect(parseTime(" 20261231 ")).toEqual({ y: 2026, mo: 12, d: 31 });
    expect(parseTime("20261111T0930")?.time).toEqual({ h: 9, mi: 30, s: 0 });
    expect(parseTime("20261111T235945")?.time).toEqual({ h: 23, mi: 59, s: 45 });
    expect(parseTime("20261111T235960")?.time).toEqual({ h: 23, mi: 59, s: 60 });
  });

  it("VALUE=DATE drops the time", () => {
    expect(parseTime("20261111T090000", { VALUE: "DATE" })).toEqual({ y: 2026, mo: 11, d: 11 });
  });

  it.each(["x20261111", "20261111T090000junk", "20260011", "20261311", "20261100", "20261111T240000", "20261111T096000", "20261111T090061"])(
    "rejects %s",
    (value) => expect(parseTime(value)).toBeNull(),
  );

  it("reads durations in weeks, days, hours, minutes and seconds with a sign", () => {
    expect(parseDuration(" PT1H ")).toBe(3_600_000);
    expect(parseDuration("P10W")).toBe(70 * 86_400_000);
    expect(parseDuration("P10D")).toBe(10 * 86_400_000);
    expect(parseDuration("PT1M30S")).toBe(90_000);
    expect(parseDuration("PT10S")).toBe(10_000);
    expect(parseDuration("-P1DT1H")).toBe(-25 * 3_600_000);
  });

  it.each(["XP1D", "P1DX", "P1DT", "PT", " P ", "P1DT "])("rejects the duration %s", (value) => expect(parseDuration(value)).toBeNull());
});

describe(".ics time zone names", () => {
  it.each(Object.entries({
    "UTC": "UTC",
    "GMT Standard Time": "Europe/London",
    "Greenwich Standard Time": "Atlantic/Reykjavik",
    "W. Europe Standard Time": "Europe/Berlin",
    "Central Europe Standard Time": "Europe/Budapest",
    "Central European Standard Time": "Europe/Warsaw",
    "Romance Standard Time": "Europe/Paris",
    "E. Europe Standard Time": "Europe/Chisinau",
    "FLE Standard Time": "Europe/Kiev",
    "GTB Standard Time": "Europe/Bucharest",
    "Russian Standard Time": "Europe/Moscow",
    "Belarus Standard Time": "Europe/Minsk",
    "Turkey Standard Time": "Europe/Istanbul",
    "Israel Standard Time": "Asia/Jerusalem",
    "Arabian Standard Time": "Asia/Dubai",
    "Arab Standard Time": "Asia/Riyadh",
    "Egypt Standard Time": "Africa/Cairo",
    "South Africa Standard Time": "Africa/Johannesburg",
    "India Standard Time": "Asia/Kolkata",
    "Bangladesh Standard Time": "Asia/Dhaka",
    "SE Asia Standard Time": "Asia/Bangkok",
    "China Standard Time": "Asia/Shanghai",
    "Singapore Standard Time": "Asia/Singapore",
    "Tokyo Standard Time": "Asia/Tokyo",
    "Korea Standard Time": "Asia/Seoul",
    "AUS Eastern Standard Time": "Australia/Sydney",
    "New Zealand Standard Time": "Pacific/Auckland",
    "Eastern Standard Time": "America/New_York",
    "Central Standard Time": "America/Chicago",
    "Mountain Standard Time": "America/Denver",
    "US Mountain Standard Time": "America/Phoenix",
    "Pacific Standard Time": "America/Los_Angeles",
    "Alaskan Standard Time": "America/Anchorage",
    "Hawaiian Standard Time": "Pacific/Honolulu",
    "Atlantic Standard Time": "America/Halifax",
    "E. South America Standard Time": "America/Sao_Paulo",
    "Argentina Standard Time": "America/Argentina/Buenos_Aires",
    "Central Standard Time (Mexico)": "America/Mexico_City",
  }))("Outlook's %s is %s", (windows, iana) => expect(zoneOf(windows)).toBe(iana));

  it("IANA names are kept as they are, even ones the prefix pattern can't read", () => {
    expect(zoneOf(" Europe/Berlin ")).toBe("Europe/Berlin");
    expect(zoneOf("Etc/GMT+5")).toBe("Etc/GMT+5");
  });

  it("a prefixed name ends with the time zone, which may have three parts", () => {
    expect(zoneOf("/citadel/America/Argentina/Buenos_Aires")).toBe("America/Argentina/Buenos_Aires");
    expect(zoneOf("Europe/Paris (custom)")).toBeUndefined();
    expect(zoneOf("Mars/Olympus")).toBeUndefined();
  });
});

describe(".ics recurrence rules", () => {
  it("reads a rule with the RRULE: prefix, an empty part and a key without a value", () => {
    expect(parseRule("RRULE:FREQ=DAILY;COUNT;")).toMatchObject({ freq: "DAILY", interval: 1 });
  });

  it("reads the week start, BYDAY with a two-digit number, the edge month days and months, and COUNT=1", () => {
    expect(parseRule("FREQ=WEEKLY;WKST=SU")?.wkst).toBe(0);
    expect(parseRule("FREQ=YEARLY;BYDAY=20MO")?.byDay).toEqual([{ n: 20, wd: 1 }]);
    expect(parseRule("FREQ=MONTHLY;BYMONTHDAY=31,-31;BYMONTH=12")).toMatchObject({ byMonthDay: [31, -31], byMonth: [12] });
    expect(parseRule("FREQ=DAILY;COUNT=1")?.count).toBe(1);
  });

  it.each([
    "FREQ=HOURLY", "FREQ=DAILY;INTERVAL=0", "FREQ=DAILY;INTERVAL=1.5", "FREQ=DAILY;COUNT=0", "FREQ=DAILY;COUNT=2.5",
    "FREQ=DAILY;UNTIL=soon", "FREQ=WEEKLY;BYDAY=XMO", "FREQ=WEEKLY;BYDAY=MOX", "FREQ=MONTHLY;BYDAY=0MO",
    "FREQ=MONTHLY;BYMONTHDAY=0", "FREQ=MONTHLY;BYMONTHDAY=1.5", "FREQ=MONTHLY;BYMONTHDAY=32", "FREQ=MONTHLY;BYMONTHDAY=1,40",
    "FREQ=YEARLY;BYMONTH=13", "FREQ=YEARLY;BYMONTH=-1", "FREQ=WEEKLY;WKST=XX",
  ])("can't expand %s", (rule) => expect(parseRule(rule)).toBeNull());
});

describe(".ics recurrence expansion", () => {
  const series = (rule: string, start = "20261102T090000Z", ...extra: string[]) =>
    ics(vevent("UID:s", `DTSTART:${start}`, `RRULE:${rule}`, ...extra));

  it("DAILY with INTERVAL", () => {
    expect(dates(series("FREQ=DAILY;INTERVAL=3;COUNT=3"), "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z"))
      .toEqual(["2026-11-02", "2026-11-05", "2026-11-08"]);
  });

  it("WEEKLY with INTERVAL counts weeks from the week start day", () => {
    const rule = "FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU";
    expect(dates(series(`${rule};WKST=MO`, "20261103T090000Z"), "2026-11-01T00:00:00Z", "2026-12-31T00:00:00Z"))
      .toEqual(["2026-11-03", "2026-11-08", "2026-11-17", "2026-11-22"]);
    expect(dates(series(`${rule};WKST=SU`, "20261103T090000Z"), "2026-11-01T00:00:00Z", "2026-12-31T00:00:00Z"))
      .toEqual(["2026-11-03", "2026-11-15", "2026-11-17", "2026-11-29"]);
  });

  it("WEEKLY every seventh week", () => {
    expect(dates(series("FREQ=WEEKLY;INTERVAL=7;COUNT=2"), "2026-11-01T00:00:00Z", "2027-01-31T00:00:00Z"))
      .toEqual(["2026-11-02", "2026-12-21"]);
  });

  it("MONTHLY with INTERVAL across the year boundary", () => {
    expect(dates(series("FREQ=MONTHLY;INTERVAL=5;COUNT=3", "20261115T090000Z"), "2026-11-01T00:00:00Z", "2027-12-31T00:00:00Z"))
      .toEqual(["2026-11-15", "2027-04-15", "2027-09-15"]);
  });

  it("MONTHLY on the 31st skips shorter months", () => {
    expect(dates(series("FREQ=MONTHLY;COUNT=3", "20260131T090000Z"), "2026-01-01T00:00:00Z", "2026-12-31T00:00:00Z"))
      .toEqual(["2026-01-31", "2026-03-31", "2026-05-31"]);
  });

  it("YEARLY with INTERVAL", () => {
    expect(dates(series("FREQ=YEARLY;INTERVAL=3;COUNT=2", "20261102T090000Z"), "2026-01-01T00:00:00Z", "2030-12-31T00:00:00Z"))
      .toEqual(["2026-11-02", "2029-11-02"]);
  });

  it("MONTHLY on several days of the month", () => {
    expect(dates(series("FREQ=MONTHLY;BYMONTHDAY=1,15;COUNT=3", "20261101T090000Z"), "2026-11-01T00:00:00Z", "2027-01-31T00:00:00Z"))
      .toEqual(["2026-11-01", "2026-11-15", "2026-12-01"]);
  });

  it("YEARLY with a numbered weekday counts within the year", () => {
    expect(dates(series("FREQ=YEARLY;BYDAY=20MO;COUNT=2", "20260518T090000Z"), "2026-01-01T00:00:00Z", "2028-01-01T00:00:00Z"))
      .toEqual(["2026-05-18", "2027-05-17"]);
    expect(dates(series("FREQ=YEARLY;BYDAY=-1FR;COUNT=2", "20261225T090000Z"), "2026-01-01T00:00:00Z", "2028-01-01T00:00:00Z"))
      .toEqual(["2026-12-25", "2027-12-31"]);
  });

  it("DAILY and WEEKLY ignore the number in BYDAY", () => {
    expect(dates(series("FREQ=WEEKLY;BYDAY=2TU;COUNT=3", "20261103T090000Z"), "2026-11-01T00:00:00Z", "2026-12-31T00:00:00Z"))
      .toEqual(["2026-11-03", "2026-11-10", "2026-11-17"]);
    expect(dates(series("FREQ=DAILY;BYDAY=1MO;COUNT=3"), "2026-11-01T00:00:00Z", "2026-12-31T00:00:00Z"))
      .toEqual(["2026-11-02", "2026-11-09", "2026-11-16"]);
  });

  it("an all-day EXDATE removes that day of a timed series, a timed one only its own moment", () => {
    const range = ["2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z"] as const;
    expect(dates(series("FREQ=DAILY;COUNT=3", "20261110T090000Z", "EXDATE;VALUE=DATE:20261111"), ...range))
      .toEqual(["2026-11-10", "2026-11-12"]);
    expect(dates(series("FREQ=DAILY;COUNT=3", "20261110T090000Z", "EXDATE:20261111T100000Z"), ...range))
      .toEqual(["2026-11-10", "2026-11-11", "2026-11-12"]);
  });

  it("an all-day EXDATE removes only that date, not the same day in other months or years", () => {
    const text = ics(vevent("UID:m", "DTSTART;VALUE=DATE:20261111", "RRULE:FREQ=MONTHLY;COUNT=14", "EXDATE;VALUE=DATE:20261211"));
    const shown = read(text, "2026-11-01T00:00:00", "2028-01-01T00:00:00").map((e) => e.start.getTime());
    expect(shown).toHaveLength(13);
    expect(shown).toContain(new Date(2026, 10, 11).getTime());
    expect(shown).toContain(new Date(2027, 11, 11).getTime());
    expect(shown).not.toContain(new Date(2026, 11, 11).getTime());
  });

  it("every weekday code is read", () => {
    expect(dates(series("FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH,FR,SA;COUNT=7", "20261101T090000Z"), "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z"))
      .toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]);
  });

  it("UNTIL without Z and a date-only UNTIL are read by the event clock, UNTIL with Z as written", () => {
    const newYork = (until: string) => ics(vevent("UID:ny", "DTSTART;TZID=America/New_York:20261109T200000", `RRULE:FREQ=DAILY;UNTIL=${until}`));
    const range = ["2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z"] as const;
    expect(starts(newYork("20261112"), ...range)).toEqual([
      "2026-11-10T01:00:00.000Z", "2026-11-11T01:00:00.000Z", "2026-11-12T01:00:00.000Z", "2026-11-13T01:00:00.000Z",
    ]);
    expect(starts(newYork("20261111T200000"), ...range)).toEqual([
      "2026-11-10T01:00:00.000Z", "2026-11-11T01:00:00.000Z", "2026-11-12T01:00:00.000Z",
    ]);
    expect(starts(newYork("20261112T000000Z"), ...range)).toEqual(["2026-11-10T01:00:00.000Z", "2026-11-11T01:00:00.000Z"]);
  });

  it("an occurrence that started before the range and lasts into it is shown", () => {
    expect(starts(series("FREQ=WEEKLY;COUNT=3", "20261102T090000Z", "DURATION:P4D"), "2026-11-13T00:00:00Z", "2026-11-14T00:00:00Z"))
      .toEqual(["2026-11-09T09:00:00.000Z"]);
  });

  it("at most 5000 occurrences are returned, an old first one not counted", () => {
    const day = 86_400_000;
    const span = (from: string) => new Date(Date.parse(from) + 6000 * day).toISOString();
    expect(read(series("FREQ=DAILY", "20000101T090000Z"), "2010-01-01T00:00:00Z", span("2010-01-01T00:00:00Z"))).toHaveLength(4998);
    expect(read(series("FREQ=DAILY", "20100101T090000Z"), "2010-01-03T00:00:00Z", span("2010-01-03T00:00:00Z"))).toHaveLength(4998);
  });
});

describe(".ics moved and edited occurrences", () => {
  it("a whole-range edit without its own length takes the length of the series", () => {
    const edit = vevent("UID:md", "RECURRENCE-ID;RANGE=THISANDFUTURE:20261110T090000Z", "DTSTART:20261110T100000Z");
    const master = (...extra: string[]) => vevent("UID:md", "DTSTART:20261109T090000Z", "DURATION:PT2H", "RRULE:FREQ=DAILY;COUNT=3", ...extra);
    const range = ["2026-11-09T00:00:00Z", "2026-11-12T00:00:00Z"] as const;
    expect(intervals(ics(master(), edit), ...range)).toEqual([
      "2026-11-09T09:00:00.000Z 2026-11-09T11:00:00.000Z",
      "2026-11-10T10:00:00.000Z 2026-11-10T12:00:00.000Z",
      "2026-11-11T10:00:00.000Z 2026-11-11T12:00:00.000Z",
    ]);
    expect(intervals(ics(master("STATUS:CANCELLED"), edit), ...range)).toEqual([
      "2026-11-10T10:00:00.000Z 2026-11-10T10:00:00.000Z",
    ]);
  });

  it("several whole-range edits apply in time order, the latest one wins and the length carries over", () => {
    const text = ics(
      vevent("UID:two", "DTSTART:20261109T090000Z", "DURATION:PT1H", "RRULE:FREQ=DAILY;COUNT=5"),
      vevent("UID:two", "RECURRENCE-ID;RANGE=THISANDFUTURE:20261112T090000Z", "DTSTART:20261112T120000Z"),
      vevent("UID:two", "RECURRENCE-ID;RANGE=THISANDFUTURE:20261110T090000Z", "DTSTART:20261110T100000Z", "DURATION:PT90M"),
    );
    expect(intervals(text, "2026-11-09T00:00:00Z", "2026-11-14T00:00:00Z")).toEqual([
      "2026-11-09T09:00:00.000Z 2026-11-09T10:00:00.000Z",
      "2026-11-10T10:00:00.000Z 2026-11-10T11:30:00.000Z",
      "2026-11-11T10:00:00.000Z 2026-11-11T11:30:00.000Z",
      "2026-11-12T12:00:00.000Z 2026-11-12T13:30:00.000Z",
      "2026-11-13T12:00:00.000Z 2026-11-13T13:30:00.000Z",
    ]);
  });

  it("a cancelled whole-range edit removes the rest of the series", () => {
    const text = ics(
      vevent("UID:c", "DTSTART:20261109T090000Z", "RRULE:FREQ=DAILY;COUNT=4"),
      vevent("UID:c", "RECURRENCE-ID;RANGE=THISANDFUTURE:20261111T090000Z", "DTSTART:20261111T090000Z", "STATUS:CANCELLED"),
    );
    expect(dates(text, "2026-11-09T00:00:00Z", "2026-11-14T00:00:00Z")).toEqual(["2026-11-09", "2026-11-10"]);
  });

  it("an all-day whole-range edit shifts the following days and keeps them all-day", () => {
    const text = ics(
      vevent("UID:ad", "DTSTART;VALUE=DATE:20261102", "RRULE:FREQ=WEEKLY;COUNT=3"),
      vevent("UID:ad", "RECURRENCE-ID;VALUE=DATE;RANGE=THISANDFUTURE:20261109", "DTSTART;VALUE=DATE:20261110"),
    );
    expect(read(text, "2026-11-01T00:00:00", "2026-12-01T00:00:00").map((e) => [e.start, e.allDay])).toEqual([
      [new Date(2026, 10, 2), true],
      [new Date(2026, 10, 10), true],
      [new Date(2026, 10, 17), true],
    ]);
  });

  it("an edit moving occurrences days earlier brings later ones into the range", () => {
    const text = ics(
      vevent("UID:early", "DTSTART:20261102T090000Z", "RRULE:FREQ=WEEKLY;COUNT=6"),
      vevent("UID:early", "RECURRENCE-ID;RANGE=THISANDFUTURE:20261116T090000Z", "DTSTART:20261110T090000Z"),
    );
    expect(starts(text, "2026-11-24T00:00:00Z", "2026-11-25T00:00:00Z")).toEqual(["2026-11-24T09:00:00.000Z"]);
  });

  it("an edit making occurrences longer shows one that started before the range", () => {
    const text = ics(
      vevent("UID:long", "DTSTART:20261102T090000Z", "DURATION:PT1H", "RRULE:FREQ=WEEKLY;COUNT=3"),
      vevent("UID:long", "RECURRENCE-ID;RANGE=THISANDFUTURE:20261109T090000Z", "DTSTART:20261109T090000Z", "DURATION:P5D"),
    );
    expect(starts(text, "2026-11-20T00:00:00Z", "2026-11-21T00:00:00Z")).toEqual(["2026-11-16T09:00:00.000Z"]);
  });
});

describe(".ics time zones defined in the file", () => {
  const at = (zone: string, tzid: string, wall: string) =>
    only(ics(zone, vevent("UID:z", `DTSTART;TZID=${tzid}:${wall}`))).start.toISOString();
  const berlin = vtimezone(
    "Custom Berlin",
    observance("DAYLIGHT", "DTSTART:19810329T020000", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU"),
    observance("STANDARD", "DTSTART:19961027T030000", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU"),
  );

  it("fixed offsets, with seconds and negative, and spaces around", () => {
    expect(at(vtimezone("Plus Three", fixedOffset(" +0300 ")), "Plus Three", "20261111T090000")).toBe("2026-11-11T06:00:00.000Z");
    expect(at(vtimezone("Seconds", fixedOffset("+013045")), "Seconds", "20261111T090000")).toBe("2026-11-11T07:29:15.000Z");
    expect(at(vtimezone("Minus Five", fixedOffset("-0500")), "Minus Five", "20261111T090000")).toBe("2026-11-11T14:00:00.000Z");
  });

  it.each([["+2300", "2026-11-10T10:00:00.000Z"], ["+0159", "2026-11-11T07:01:00.000Z"], ["+010059", "2026-11-11T07:59:01.000Z"]])(
    "the largest offset parts are valid: %s",
    (offset, utc) => expect(at(vtimezone("Edge", fixedOffset(offset)), "Edge", "20261111T090000")).toBe(utc),
  );

  it.each(["+2400", "+0360", "+030060", "x+0300", "+0300x"])(
    "a time zone with the offset %s is unreadable and the time floats",
    (offset) => expect(at(vtimezone("Broken", fixedOffset(offset)), "Broken", "20261111T090000"))
      .toBe(new Date(2026, 10, 11, 9).toISOString()),
  );

  it("a time zone without usable observances is ignored", () => {
    const local = new Date(2026, 10, 11, 9).toISOString();
    expect(at(vtimezone("Empty"), "Empty", "20261111T090000")).toBe(local);
    expect(at(vtimezone("No from", observance("STANDARD", "DTSTART:19700101T000000", "TZOFFSETTO:+0300")), "No from", "20261111T090000")).toBe(local);
    expect(at(vtimezone("No to", observance("STANDARD", "DTSTART:19700101T000000", "TZOFFSETFROM:+0300")), "No to", "20261111T090000")).toBe(local);
    expect(at(vtimezone("Date only", observance("STANDARD", "DTSTART:19700101", "TZOFFSETFROM:+0300", "TZOFFSETTO:+0300")), "Date only", "20261111T090000"))
      .toBe(local);
  });

  it("the TZID is trimmed on both sides and other zone lines do not rename it", () => {
    const zone = ["BEGIN:VTIMEZONE", "TZID: Plus Three ", "LAST-MODIFIED:20200101T000000Z", ...fixedOffset("+0300"), "END:VTIMEZONE"].join("\r\n");
    expect(at(zone, '"Plus Three "', "20261111T090000")).toBe("2026-11-11T06:00:00.000Z");
  });

  it("summer, the spring gap, the repeated autumn hour and the exact moment of the change", () => {
    expect(at(berlin, "Custom Berlin", "20260701T090000")).toBe("2026-07-01T07:00:00.000Z");
    expect(at(berlin, "Custom Berlin", "20260329T023000")).toBe("2026-03-29T01:30:00.000Z");
    expect(at(berlin, "Custom Berlin", "20261025T023000")).toBe("2026-10-25T00:30:00.000Z");
    expect(at(berlin, "Custom Berlin", "20261025T030000")).toBe("2026-10-25T02:00:00.000Z");
  });

  it("a wall time in the spring gap moves forward by the gap of that change, not an earlier one", () => {
    const late = vtimezone(
      "Late Berlin",
      observance("STANDARD", "DTSTART:19961027T030000", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU"),
      observance("DAYLIGHT", "DTSTART:19970330T020000", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU"),
    );
    expect(at(late, "Late Berlin", "20260329T020000")).toBe("2026-03-29T01:00:00.000Z");
    expect(at(late, "Late Berlin", "20260329T023000")).toBe("2026-03-29T01:30:00.000Z");
  });

  it("a stray END of an observance inside a time zone is ignored", () => {
    const zone = ["BEGIN:VTIMEZONE", "TZID:Stray", "END:STANDARD", ...fixedOffset("+0300"), "END:VTIMEZONE"].join("\r\n");
    expect(at(zone, "Stray", "20261111T090000")).toBe("2026-11-11T06:00:00.000Z");
  });

  it("changes given by RDATE count, in any order they are listed", () => {
    const zone = vtimezone(
      "Listed",
      observance("STANDARD", "DTSTART:20251026T030000", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "RDATE:20261025T030000"),
      observance("DAYLIGHT", "DTSTART:20250330T020000", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "RDATE:20260329T020000"),
    );
    expect(at(zone, "Listed", "20260701T090000")).toBe("2026-07-01T07:00:00.000Z");
    expect(at(zone, "Listed", "20261201T090000")).toBe("2026-12-01T08:00:00.000Z");
  });
});
