import { describe, expect, it } from "vitest";
import { parseQuickEn } from "./quick-en";

// Wednesday, November 4, 2026, 18:00
const now = new Date(2026, 10, 4, 18, 0);
const quick = (input: string) => parseQuickEn(input, now, []);
const at = (d: number, h: number, m = 0, month = 10) => new Date(2026, month, d, h, m);

describe("English quick add: dates", () => {
  it("a month name with a day and year, or written in full with an ordinal", () => {
    expect(quick("Nov 5, 2027 trip")).toMatchObject({ title: "trip", start: new Date(2027, 10, 5), allDay: true });
    expect(quick("November 5th lunch")).toMatchObject({ title: "lunch", start: at(5, 0) });
  });

  it("the day after tomorrow, today and in some days or weeks", () => {
    expect(quick("the day after tomorrow dentist")).toMatchObject({ title: "dentist", start: at(6, 0) });
    expect(quick("today 9am standup")).toMatchObject({ title: "standup", start: at(4, 9) });
    expect(quick("in 3 days review").start).toEqual(at(7, 0));
    expect(quick("in 2 weeks review").start).toEqual(at(18, 0));
  });

  it("a title with the word 'undefined' is not a weekday", () => {
    expect(quick("undefined behaviour talk")).toMatchObject({ title: "undefined behaviour talk", start: at(4, 0) });
  });
});

describe("English quick add: times", () => {
  it("12am is midnight, 12pm is noon, 'midnight' is a time", () => {
    expect(quick("tomorrow 12am flight").start).toEqual(at(5, 0));
    expect(quick("tomorrow 12pm lunch").start).toEqual(at(5, 12));
    expect(quick("tomorrow midnight launch")).toMatchObject({ title: "launch", start: at(5, 0), allDay: false });
  });

  it("a range within one hour takes the end's pm", () => {
    expect(quick("tomorrow 1-1:30pm call")).toMatchObject({ start: at(5, 13), end: at(5, 13, 30) });
  });

  it("an impossible range or clock time is dropped, the event stays all-day", () => {
    expect(quick("tomorrow 9-25 workers").allDay).toBe(true);
    expect(quick("tomorrow 13pm demo").allDay).toBe(true);
    expect(quick("tomorrow at 9:75 demo").allDay).toBe(true);
    expect(quick("tomorrow at 25 people").allDay).toBe(true);
  });

  it("tonight keeps a time already in 24 hours", () => {
    expect(quick("tonight 20:00 party").start).toEqual(at(4, 20));
  });

  it("an hour right after any day word, whatever its case", () => {
    expect(quick("today 9 standup").start).toEqual(at(4, 9));
    expect(quick("tonight 8 party").start).toEqual(at(4, 20));
    expect(quick("tmrw 9 gym").start).toEqual(at(5, 9));
    expect(quick("Nov 6 10 meeting").start).toEqual(at(6, 10));
    expect(quick("Tomorrow 9 gym").start).toEqual(at(5, 9));
  });

  it("a title that only starts like a unit doesn't stop the bare hour", () => {
    expect(quick("tomorrow 9 hockey")).toMatchObject({ title: "hockey", start: at(5, 9) });
    expect(quick("fri 18 theatre")).toMatchObject({ title: "theatre", start: at(6, 18) });
    expect(quick("tomorrow 10 office party")).toMatchObject({ title: "office party", start: at(5, 10) });
    expect(quick("tomorrow 9 weekly sync")).toMatchObject({ title: "weekly sync", start: at(5, 9) });
  });

  it("a real unit after the number still isn't an hour", () => {
    expect(quick("tomorrow 9 hours drive")).toMatchObject({ title: "drive", allDay: true });
    expect(quick("tomorrow 30 mins call")).toMatchObject({ title: "call", allDay: true });
    expect(quick("tomorrow at 2 hours drive")).toMatchObject({ allDay: true });
  });
});

describe("English quick add: durations and title", () => {
  it("fractional hours with a comma and hours spelled 'hrs'", () => {
    expect(quick("tomorrow 9am meeting 1,5 h").end).toEqual(at(5, 10, 30));
    expect(quick("tomorrow 9am workshop 2 hrs").end).toEqual(at(5, 11));
  });

  it("a dangling preposition is dropped from the title", () => {
    expect(quick("tomorrow dinner in").title).toBe("dinner");
  });
});
