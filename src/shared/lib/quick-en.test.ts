import { describe, expect, it } from "vitest";
import { parseQuick } from "./quick";

// Wednesday, 4 November 2026, 18:00
const now = new Date(2026, 10, 4, 18, 0);
const calendars = [
  { id: "me", name: "Personal" },
  { id: "work", name: "Work" },
];
const at = (d: number, h: number, m = 0, month = 10) => new Date(2026, month, d, h, m);
const en = (text: string) => parseQuick(text, now, calendars, "en");

describe("quick add in English", () => {
  it("tomorrow, am/pm time and duration", () => {
    expect(en("tomorrow 7pm English class 50 min")).toMatchObject({
      title: "English class",
      allDay: false,
      start: at(5, 19),
      end: at(5, 19, 50),
    });
    expect(en("standup tomorrow 9am #work @Office_Gdynia half an hour")).toMatchObject({
      title: "standup",
      calendarId: "work",
      location: "Office Gdynia",
      start: at(5, 9),
      end: at(5, 9, 30),
    });
  });

  it("ranges share am/pm unless that breaks the order", () => {
    expect(en("dinner 7-9pm")).toMatchObject({ title: "dinner", start: at(4, 19), end: at(4, 21) });
    expect(en("11-1pm workshop tomorrow")).toMatchObject({ start: at(5, 11), end: at(5, 13) });
    expect(en("call from 2 to 3:30pm fri")).toMatchObject({ title: "call", start: at(6, 14), end: at(6, 15, 30) });
    expect(en("today 19:00-20:30 gym").end).toEqual(at(4, 20, 30));
  });

  it("weekdays: the nearest one, next skips today", () => {
    expect(en("lunch with Ann fri at noon")).toMatchObject({ title: "lunch with Ann", start: at(6, 12) });
    expect(en("wed 20:00 training").start).toEqual(at(4, 20));
    expect(en("next wed review")).toMatchObject({ title: "review", allDay: true, start: at(11, 0) });
    expect(en("on Saturday birthday party")).toMatchObject({ title: "birthday party", allDay: true, start: at(7, 0) });
  });

  it("dates with month names; a past date without a year is next year", () => {
    expect(en("Dec 5 10:00 dentist").start).toEqual(at(5, 10, 0, 11));
    expect(en("5th of March vacation")).toMatchObject({ title: "vacation", start: new Date(2027, 2, 5) });
    expect(en("November 12, 2026 haircut").start).toEqual(at(12, 0));
    expect(en("in 3 days 12:00 lunch").start).toEqual(at(7, 12));
  });

  it("tonight, a bare hour after a day, a passed time means tomorrow", () => {
    expect(en("tonight at 8 movie")).toMatchObject({ title: "movie", start: at(4, 20) });
    expect(en("fri 18 cinema 2h")).toMatchObject({ title: "cinema", start: at(6, 18), end: at(6, 20) });
    expect(en("tomorrow 9 gym")).toMatchObject({ title: "gym", start: at(5, 9) });
    expect(en("8am workout").start).toEqual(at(5, 8));
  });

  it("leaves numbers inside the title alone", () => {
    expect(en("buy 2 tickets")).toMatchObject({ title: "buy 2 tickets", allDay: true });
    // word boundaries hold for every alternative, not only the outer ones
    expect(en("tomorrows plan")).toMatchObject({ title: "tomorrows plan", start: at(4, 0) });
    expect(en("tomorrow 2h cleaning")).toMatchObject({ title: "cleaning", allDay: true });
  });
});
