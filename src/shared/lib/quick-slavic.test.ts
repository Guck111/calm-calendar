import { describe, expect, it } from "vitest";
import type { QuickCalendar, QuickResult } from "./quick-core";
import { parseQuickBe } from "./quick-be";
import { parseQuickRu } from "./quick-ru";
import { parseQuickUk } from "./quick-uk";

// Wednesday, November 4, 2026, 18:00
const now = new Date(2026, 10, 4, 18, 0);
const at = (d: number, h = 0, m = 0, month = 10) => new Date(2026, month, d, h, m);

type Parser = (input: string, now: Date, calendars: QuickCalendar[]) => QuickResult;
type Phrases = Record<
  | "morning" | "night" | "pastDay" | "evening" | "afternoon" | "midnight" | "noon" | "dayAfterTomorrow" | "inWeeks" | "inDays" | "capitalMonth"
  | "dayOf" | "dayOfToday" | "dayOf31" | "commaDay" | "commaNoSpace" | "commaInside" | "undefinedWord"
  | "rangeStartPart" | "badRange" | "badClock" | "badShort" | "todayHour" | "afterTomorrowHour" | "monthHour" | "dottedHour",
  string
>;

const LANGUAGES: [string, Parser, Phrases][] = [
  ["Russian", parseQuickRu, {
    morning: "завтра в 9 утра зарядка", night: "завтра в 3 ночи рейс", pastDay: "3-го встреча",
    evening: "завтра в 7 вечера ужин", afternoon: "завтра в 3 дня обед", midnight: "завтра в 12 ночи релиз",
    noon: "завтра в 12 дня обед", dayAfterTomorrow: "послезавтра обед", inWeeks: "через 2 недели ревью",
    inDays: "через 3 дня ревью", capitalMonth: "5 Ноября встреча", dayOf: "14-го встреча", dayOfToday: "4-го встреча",
    dayOf31: "31-го встреча", commaDay: "встреча, 14  ", commaNoSpace: "встреча,14", commaInside: "кино, 5 друзей",
    undefinedWord: "undefined доклад", rangeStartPart: "завтра с 7 вечера до 21 ужин", badRange: "завтра 9-25 люди",
    badClock: "завтра 9:75 люди", badShort: "завтра в 25 человек", todayHour: "сегодня 9 встреча",
    afterTomorrowHour: "послезавтра 9 встреча", monthHour: "6 ноября 10 встреча", dottedHour: "06.11 10 встреча",
  }],
  ["Ukrainian", parseQuickUk, {
    morning: "завтра о 9 ранку зарядка", night: "завтра о 3 ночі рейс", pastDay: "3-го зустріч",
    evening: "завтра о 7 вечора вечеря", afternoon: "завтра о 3 дня обід", midnight: "завтра о 12 ночі реліз",
    noon: "завтра о 12 дня обід", dayAfterTomorrow: "післязавтра обід", inWeeks: "через 2 тижні рев'ю",
    inDays: "за 3 дні рев'ю", capitalMonth: "5 Листопада зустріч", dayOf: "14-го зустріч", dayOfToday: "4-го зустріч",
    dayOf31: "31-го зустріч", commaDay: "зустріч, 14  ", commaNoSpace: "зустріч,14", commaInside: "кіно, 5 друзів",
    undefinedWord: "undefined доповідь", rangeStartPart: "завтра з 7 вечора до 21 вечеря", badRange: "завтра 9-25 люди",
    badClock: "завтра 9:75 люди", badShort: "завтра о 25 людей", todayHour: "сьогодні 9 зустріч",
    afterTomorrowHour: "післязавтра 9 зустріч", monthHour: "6 листопада 10 зустріч", dottedHour: "06.11 10 зустріч",
  }],
  ["Belarusian", parseQuickBe, {
    morning: "заўтра а 9 раніцы зарадка", night: "заўтра а 3 ночы рэйс", pastDay: "3-га сустрэча",
    evening: "заўтра а 7 вечара вячэра", afternoon: "заўтра а 3 дня абед", midnight: "заўтра а 12 ночы рэліз",
    noon: "заўтра а 12 дня абед", dayAfterTomorrow: "паслязаўтра абед", inWeeks: "праз 2 тыдні агляд",
    inDays: "праз 3 дні агляд", capitalMonth: "5 Лістапада сустрэча", dayOf: "14-га сустрэча", dayOfToday: "4-га сустрэча",
    dayOf31: "31-га сустрэча", commaDay: "сустрэча, 14  ", commaNoSpace: "сустрэча,14", commaInside: "кіно, 5 сяброў",
    undefinedWord: "undefined даклад", rangeStartPart: "заўтра з 7 вечара да 21 вячэра", badRange: "заўтра 9-25 людзі",
    badClock: "заўтра 9:75 людзі", badShort: "заўтра а 25 людзей", todayHour: "сёння 9 сустрэча",
    afterTomorrowHour: "паслязаўтра 9 сустрэча", monthHour: "6 лістапада 10 сустрэча", dottedHour: "06.11 10 сустрэча",
  }],
];

describe.each(LANGUAGES)("%s quick add", (_, parse, p) => {
  const quick = (input: string) => parse(input, now, []);

  it("parts of the day turn the hour into the 24-hour clock", () => {
    expect(quick(p.morning).start).toEqual(at(5, 9));
    expect(quick(p.night).start).toEqual(at(5, 3));
    expect(quick(p.evening).start).toEqual(at(5, 19));
    expect(quick(p.afternoon).start).toEqual(at(5, 15));
    expect(quick(p.midnight).start).toEqual(at(5, 0));
    expect(quick(p.noon).start).toEqual(at(5, 12));
  });

  it("the day after tomorrow, in some days or weeks, a month name in capitals", () => {
    expect(quick(p.dayAfterTomorrow).start).toEqual(at(6));
    expect(quick(p.inWeeks).start).toEqual(at(18));
    expect(quick(p.inDays).start).toEqual(at(7));
    expect(quick(p.capitalMonth).start).toEqual(at(5));
  });

  it("a day of the month is this month if it hasn't passed, today included, otherwise a later month", () => {
    expect(quick(p.dayOf).start).toEqual(at(14));
    expect(quick(p.dayOfToday).start).toEqual(at(4));
    expect(quick(p.pastDay).start).toEqual(at(3, 0, 0, 11));
    expect(quick(p.dayOf31).start).toEqual(at(31, 0, 0, 11));
  });

  it("a day of the month after a comma only at the very end", () => {
    expect(quick(p.commaDay).start).toEqual(at(14));
    expect(quick(p.commaNoSpace).start).toEqual(at(14));
    expect(quick(p.commaInside).start).toEqual(at(4));
  });

  it("a title with the word 'undefined' is not a weekday", () => {
    expect(quick(p.undefinedWord).start).toEqual(at(4));
  });

  it("a part of the day after the start of a range applies to the start", () => {
    expect(quick(p.rangeStartPart)).toMatchObject({ start: at(5, 19), end: at(5, 21) });
  });

  it("impossible ranges and clock times leave the event all-day", () => {
    expect(quick(p.badRange).allDay).toBe(true);
    expect(quick(p.badClock).allDay).toBe(true);
    expect(quick(p.badShort).allDay).toBe(true);
  });

  it("an hour right after today, the day after tomorrow, a month day or a dotted date", () => {
    expect(quick(p.todayHour).start).toEqual(at(4, 9));
    expect(quick(p.afterTomorrowHour).start).toEqual(at(6, 9));
    expect(quick(p.monthHour).start).toEqual(at(6, 10));
    expect(quick(p.dottedHour).start).toEqual(at(6, 10));
  });
});
