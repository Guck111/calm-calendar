import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "../i18n";
import { toDateKey } from "./date";
import {
  describeRule,
  filterRDates,
  followStart,
  formatRule,
  isLastWeekday,
  monthlyNth,
  occurrences,
  orderedWeekdays,
  parseRecurrence,
  parseUntil,
  presetOf,
  presetRule,
  weekdayLabel,
  weekdayLongName,
  type Rule,
} from "./rrule";

afterEach(() => setLang("ru"));

// Wednesday, November 4, 2026, 9:00 by the event clock
const wed = new Date(2026, 10, 4, 9, 0);
const rule = (line: string, start = wed) => parseRecurrence([`RRULE:${line}`], start).rule;
const keys = (dates: Date[]) => dates.map(toDateKey);
const make = (freq: Rule["freq"], extra: Partial<Rule> = {}): Rule => ({ freq, interval: 1, days: [], end: { kind: "never" }, ...extra });

describe("weekday position in the month", () => {
  it("the last weekday is judged by the length of its own month", () => {
    expect(isLastWeekday(new Date(2026, 1, 22))).toBe(true);
    expect(isLastWeekday(new Date(2026, 10, 23))).toBe(false);
  });

  it("the fourth weekday stays fourth, only the fifth becomes the last", () => {
    expect(monthlyNth(new Date(2026, 10, 23))).toBe(4);
    expect(monthlyNth(new Date(2026, 10, 30))).toBe(-1);
  });
});

describe("UNTIL by the event clock", () => {
  it("rejects values that are not a date or a date with time", () => {
    expect(parseUntil("x20261231", wed)).toBeNull();
    expect(parseUntil("20261231T235959Zjunk", wed)).toBeNull();
  });

  it("an UNTIL time before the start time of day ends the day before, the same or a later time keeps the day", () => {
    expect(parseUntil("20261231T100000", wed)).toBe("2026-12-31");
    expect(parseUntil("20261231T080000", wed)).toBe("2026-12-30");
    expect(parseUntil("20261231T091500", wed)).toBe("2026-12-31");
    expect(parseUntil("20261231T090030", wed)).toBe("2026-12-31");
    expect(parseUntil("20261231T090000Z", wed, "UTC")).toBe("2026-12-31");
    expect(parseUntil("20261231T093000Z", wed, "UTC")).toBe("2026-12-31");
    expect(parseUntil("20261231T090030Z", wed, "UTC")).toBe("2026-12-31");
  });
});

describe("rule parsing edge cases", () => {
  it.each([
    "FREQ=DAILY;", "FREQ=DAILY;COUNT", "FREQ=DAILY;FREQ=WEEKLY", "freq=daily;FREQ=WEEKLY", "FREQ=DAILY;BYHOUR=9",
    "FREQ=HOURLY", "FREQ=DAILY;INTERVAL=0", "FREQ=DAILY;INTERVAL=1.5", "FREQ=DAILY;COUNT=0", "FREQ=DAILY;COUNT=1.5",
    "FREQ=DAILY;UNTIL=soon", "FREQ=MONTHLY;BYMONTH=11", "FREQ=YEARLY;BYMONTH=5", "FREQ=WEEKLY;BYDAY=XWE",
    "FREQ=WEEKLY;BYDAY=WEX", "FREQ=WEEKLY;BYDAY=XX", "FREQ=WEEKLY;WKST=XX", "FREQ=WEEKLY;BYDAY=1WE", "FREQ=DAILY;BYDAY=1WE",
    "FREQ=YEARLY;BYDAY=1WE", "FREQ=MONTHLY;BYDAY=1WE,2WE", "FREQ=MONTHLY;BYDAY=1WE;BYMONTHDAY=4", "FREQ=MONTHLY;BYDAY=1TH",
  ])("can't edit %s", (line) => expect(rule(line)).toBeNull());

  it("a matching month and day of month in a yearly rule change nothing", () => {
    expect(rule("FREQ=YEARLY;BYMONTH=11")).toEqual(make("YEARLY"));
    expect(rule("FREQ=YEARLY;BYMONTHDAY=4")).toEqual(make("YEARLY"));
  });

  it("the week start is kept only when given", () => {
    expect(rule("FREQ=WEEKLY;WKST=SU")?.weekStartsOn).toBe("SU");
    expect(rule("FREQ=WEEKLY")).not.toHaveProperty("weekStartsOn");
  });

  it("the fourth weekday is allowed, the fifth is not", () => {
    expect(rule("FREQ=MONTHLY;BYDAY=4WE", new Date(2026, 10, 25))?.nth).toBe(4);
    expect(rule("FREQ=MONTHLY;BYDAY=5WE", new Date(2026, 11, 30))).toBeNull();
  });

  it("only a single real RRULE line without EXRULE is a rule, other lines stay extra", () => {
    expect(parseRecurrence(["X-RRULE:FREQ=DAILY"], wed)).toEqual({ rule: null, extra: ["X-RRULE:FREQ=DAILY"] });
    expect(parseRecurrence(["EXDATE:20261111T090000Z"], wed).rule).toBeNull();
    expect(parseRecurrence(["RRULE:FREQ=DAILY", "RRULE:FREQ=WEEKLY"], wed).rule).toBeNull();
    expect(parseRecurrence(["RRULE:FREQ=DAILY", "EXRULE:FREQ=WEEKLY"], wed)).toEqual({ rule: null, extra: ["EXRULE:FREQ=WEEKLY"] });
    expect(parseRecurrence(["RRULE:FREQ=DAILY", "X-EXRULE:FREQ=WEEKLY"], wed).rule).toEqual(make("DAILY"));
  });
});

describe("rule building edge cases", () => {
  it("weekdays are written Monday first and Sunday last, the start day when none are chosen", () => {
    expect(formatRule(make("WEEKLY", { days: ["SU", "MO"] }), wed, false)).toBe("RRULE:FREQ=WEEKLY;BYDAY=MO,SU");
    expect(formatRule(make("WEEKLY"), wed, false)).toBe("RRULE:FREQ=WEEKLY;BYDAY=WE");
  });

  it("a monthly rule by date has no BYDAY", () => {
    expect(formatRule(presetRule("monthly", wed), wed, false)).toBe("RRULE:FREQ=MONTHLY");
  });
});

describe("presets edge cases", () => {
  it("each preset is exactly its rule", () => {
    expect(PRESET_RULES.map((id) => presetRule(id, wed))).toEqual([
      make("DAILY"),
      make("WEEKLY", { days: ["MO", "TU", "WE", "TH", "FR"] }),
      make("WEEKLY", { days: ["WE"] }),
      make("MONTHLY"),
      make("MONTHLY", { nth: 1 }),
      make("YEARLY"),
    ]);
  });

  it("interval and nth weekday tell presets apart", () => {
    expect(presetOf(make("DAILY", { interval: 2 }), wed)).toBeNull();
    expect(presetOf(presetRule("monthlyNth", wed), wed)).toBe("monthlyNth");
  });
});

const PRESET_RULES = ["daily", "weekdays", "weekly", "monthly", "monthlyNth", "yearly"] as const;

describe("start shift edge cases", () => {
  const fri = new Date(2026, 10, 27);

  it("a weekly rule on another day and rules without nth weekday are left as they are", () => {
    const thu = new Date(2026, 10, 5);
    const onFriday = make("WEEKLY", { days: ["FR"] });
    expect(followStart(onFriday, wed, thu)).toBe(onFriday);
    const weekdays = presetRule("weekdays", wed);
    expect(followStart(weekdays, wed, thu)).toEqual(weekdays);
    const monthly = presetRule("monthly", wed);
    expect(followStart(monthly, wed, thu)).toEqual(monthly);
  });

  it("'last' stays last on a last weekday, otherwise the position is counted", () => {
    const last = make("MONTHLY", { nth: -1 });
    expect(followStart(last, new Date(2026, 10, 30), fri).nth).toBe(-1);
    expect(followStart(last, new Date(2026, 10, 30), new Date(2026, 10, 23)).nth).toBe(4);
    expect(followStart(make("MONTHLY", { nth: 2 }), new Date(2026, 10, 10), fri).nth).toBe(4);
  });
});

describe("splitting RDATE lines", () => {
  const split = new Date("2026-11-11T08:30:00Z");

  it("other lines, even ending in RDATE, are kept on both sides", () => {
    expect(filterRDates(["X-RDATE:20261101T090000Z"], split, "following")).toEqual(["X-RDATE:20261101T090000Z"]);
  });

  it("the time zone comes from a quoted or plain TZID, or from the event", () => {
    const tokyoMorning = "20261111T170000";
    expect(filterRDates([`RDATE;TZID="Asia/Tokyo":${tokyoMorning}`], split, "before")).toEqual([`RDATE;TZID="Asia/Tokyo":${tokyoMorning}`]);
    expect(filterRDates([`RDATE;TZID=Asia/Tokyo:${tokyoMorning}`], split, "before")).toEqual([`RDATE;TZID=Asia/Tokyo:${tokyoMorning}`]);
    expect(filterRDates([`RDATE:${tokyoMorning}`], split, "before", "Asia/Tokyo")).toEqual([`RDATE:${tokyoMorning}`]);
  });

  it("an unreadable value stays with the original series, a line left empty is dropped", () => {
    expect(filterRDates(["RDATE:soon,20261101T090000Z"], split, "before")).toEqual(["RDATE:soon,20261101T090000Z"]);
    expect(filterRDates(["RDATE:soon,20261101T090000Z"], split, "following")).toEqual([]);
  });
});

describe("occurrences edge cases", () => {
  const until = new Date(2030, 0, 1);

  it("DAILY and YEARLY with an interval", () => {
    expect(keys(occurrences(make("DAILY", { interval: 3 }), wed, new Date(2026, 10, 11)))).toEqual(["2026-11-04", "2026-11-07", "2026-11-10"]);
    expect(keys(occurrences(make("YEARLY", { interval: 3 }), wed, until))).toEqual(["2026-11-04", "2029-11-04"]);
  });

  it("MONTHLY with an interval across the year boundary", () => {
    const start = new Date(2026, 10, 15, 9);
    expect(keys(occurrences(make("MONTHLY", { interval: 5 }), start, new Date(2027, 11, 31)))).toEqual(["2026-11-15", "2027-04-15", "2027-09-15"]);
    expect(keys(occurrences(make("MONTHLY", { interval: 7 }), start, new Date(2028, 0, 31)))).toEqual(["2026-11-15", "2027-06-15", "2028-01-15"]);
  });

  it("the second Tuesday of the month", () => {
    const start = new Date(2026, 10, 10, 9);
    expect(keys(occurrences(make("MONTHLY", { nth: 2 }), start, new Date(2027, 0, 31)))).toEqual(["2026-11-10", "2026-12-08", "2027-01-12"]);
  });

  it("weeks of a biweekly rule start on Monday unless WKST says otherwise", () => {
    const tue = new Date(2026, 10, 3, 9);
    const biweekly = (extra: Partial<Rule>) => keys(occurrences(make("WEEKLY", { interval: 2, days: ["SU", "TU"], ...extra }), tue, new Date(2026, 10, 30)));
    expect(biweekly({})).toEqual(["2026-11-03", "2026-11-08", "2026-11-17", "2026-11-22"]);
    expect(biweekly({ weekStartsOn: "SU" })).toEqual(["2026-11-03", "2026-11-15", "2026-11-17", "2026-11-29"]);
  });

  it("the start is always the first occurrence, and one exactly at the limit is not included", () => {
    expect(keys(occurrences(make("WEEKLY", { days: ["MO"] }), wed, new Date(2026, 10, 17)))).toEqual(["2026-11-04", "2026-11-09", "2026-11-16"]);
    expect(keys(occurrences(make("DAILY"), wed, new Date(2026, 10, 6, 9, 0)))).toEqual(["2026-11-04", "2026-11-05"]);
  });
});

describe("weekday labels", () => {
  it("names each weekday", () => {
    setLang("en", "en-GB");
    expect(["SU", "MO", "SA"].map((d) => weekdayLongName(d as "SU"))).toEqual(["Sunday", "Monday", "Saturday"]);
    expect(weekdayLabel("TH")).toBe("Thu");
  });

  it("lists weekdays from the region's first day of the week", () => {
    setLang("en", "en-GB");
    expect(orderedWeekdays()).toEqual(["MO", "TU", "WE", "TH", "FR", "SA", "SU"]);
    setLang("en", "en-US");
    expect(orderedWeekdays()).toEqual(["SU", "MO", "TU", "WE", "TH", "FR", "SA"]);
  });
});

describe("rule description edge cases", () => {
  it("weekdays every other week and a single weekday are not 'on weekdays'", () => {
    expect(describeRule(make("WEEKLY", { interval: 2, days: ["MO", "TU", "WE", "TH", "FR"] }), wed)).toBe("Раз в 2 недели, по пн, вт, ср, чт и пт");
    expect(describeRule(make("WEEKLY", { days: ["WE"] }), wed)).toBe("Каждую неделю, по ср");
  });

  it("weekdays are listed in the week order of the region, in the short list style", () => {
    expect(describeRule(make("WEEKLY", { days: ["FR", "MO"] }), wed)).toBe("Каждую неделю, по пн и пт");
    setLang("en", "en-US");
    expect(describeRule(make("WEEKLY", { days: ["FR", "MO", "WE"] }), wed)).toBe("Weekly, on Mon, Wed, & Fri");
  });
});
