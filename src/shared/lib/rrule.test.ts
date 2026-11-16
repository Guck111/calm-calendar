import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "../i18n";
import {
  buildRecurrence,
  describeRule,
  followStart,
  formatRule,
  occurrences,
  parseRecurrence,
  presetOf,
  presetRule,
  truncateBefore,
  utcStamp,
  type Rule,
} from "./rrule";
import { toDateKey } from "./date";

afterEach(() => setLang("ru"));

// Wednesday, November 4, 2026, 9:00 local time
const wed = new Date(2026, 10, 4, 9, 0);
const rule = (lines: string[], start = wed) => parseRecurrence(lines, start).rule;
const keys = (dates: Date[]) => dates.map(toDateKey);

describe("rule parsing", () => {
  it("understands frequency, interval, weekdays and end", () => {
    expect(rule(["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10"])).toEqual({
      freq: "WEEKLY",
      interval: 2,
      days: ["MO", "WE"],
      end: { kind: "count", count: 10 },
    });
    expect(rule(["RRULE:FREQ=DAILY;UNTIL=20261231"])?.end).toEqual({ kind: "until", date: "2026-12-31" });
  });

  it("without BYDAY a weekly rule repeats on the start day", () => {
    expect(rule(["RRULE:FREQ=WEEKLY"])?.days).toEqual(["WE"]);
  });

  it("UNTIL in UTC is converted to a local day", () => {
    const end = new Date(2026, 11, 31, 23, 59, 59);
    expect(rule([`RRULE:FREQ=DAILY;UNTIL=${utcStamp(end)}`])?.end).toEqual({ kind: "until", date: "2026-12-31" });
  });

  it("nth weekday of the month — only if it matches the start", () => {
    expect(rule(["RRULE:FREQ=MONTHLY;BYDAY=1WE"])?.nth).toBe(1);
    expect(rule(["RRULE:FREQ=MONTHLY;BYDAY=2WE"])).toBeNull();
    // November 25, 2026 is the last Wednesday of the month
    expect(rule(["RRULE:FREQ=MONTHLY;BYDAY=-1WE"], new Date(2026, 10, 25))?.nth).toBe(-1);
  });

  it("complex rules are not edited, but EXDATE lines are kept", () => {
    const parsed = parseRecurrence(["RRULE:FREQ=MONTHLY;BYSETPOS=-1;BYDAY=MO,TU", "EXDATE:20261111T090000Z"], wed);
    expect(parsed.rule).toBeNull();
    expect(parsed.extra).toEqual(["EXDATE:20261111T090000Z"]);
    expect(rule(["RRULE:FREQ=DAILY;COUNT=2;UNTIL=20261231"])).toBeNull();
    expect(rule(["RRULE:FREQ=MONTHLY;BYMONTHDAY=5"])).toBeNull();
    expect(rule(["RRULE:FREQ=MONTHLY;BYMONTHDAY=4"])).not.toBeNull();
  });
});

describe("rule building", () => {
  it("round trip without losses", () => {
    const r: Rule = { freq: "WEEKLY", interval: 2, days: ["FR", "MO"], end: { kind: "count", count: 5 } };
    const line = formatRule(r, wed, false);
    expect(line).toBe("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR;COUNT=5");
    expect(rule([line])).toEqual({ ...r, days: ["MO", "FR"] });
  });

  it("UNTIL: a date for an all-day event, end of day in UTC for a timed event", () => {
    const r: Rule = { freq: "DAILY", interval: 1, days: [], end: { kind: "until", date: "2026-12-31" } };
    expect(formatRule(r, wed, true)).toBe("RRULE:FREQ=DAILY;UNTIL=20261231");
    expect(formatRule(r, wed, false)).toBe(`RRULE:FREQ=DAILY;UNTIL=${utcStamp(new Date(2026, 11, 31, 23, 59, 59))}`);
  });

  it("nth weekday is written via BYDAY", () => {
    expect(buildRecurrence(presetRule("monthlyNth", wed), ["EXDATE:x"], wed, false)).toEqual([
      "RRULE:FREQ=MONTHLY;BYDAY=1WE",
      "EXDATE:x",
    ]);
    expect(buildRecurrence(null, ["EXDATE:x"], wed, false)).toEqual([]);
  });
});

describe("presets", () => {
  it("recognizes the preset from a Google rule", () => {
    expect(presetOf(rule(["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"]) as Rule, wed)).toBe("weekdays");
    expect(presetOf(rule(["RRULE:FREQ=WEEKLY;BYDAY=WE"]) as Rule, wed)).toBe("weekly");
    expect(presetOf(rule(["RRULE:FREQ=YEARLY"]) as Rule, wed)).toBe("yearly");
    expect(presetOf(rule(["RRULE:FREQ=DAILY;COUNT=3"]) as Rule, wed)).toBeNull();
  });

  it("the fifth weekday of the month becomes the last", () => {
    // November 30, 2026 is the fifth and last Monday
    expect(presetRule("monthlyNth", new Date(2026, 10, 30)).nth).toBe(-1);
  });
});

describe("start shift", () => {
  it("'every Wednesday' becomes 'every Thursday'", () => {
    const thu = new Date(2026, 10, 5, 9, 0);
    expect(followStart(presetRule("weekly", wed), wed, thu).days).toEqual(["TH"]);
    // several weekdays are left alone
    expect(followStart(presetRule("weekdays", wed), wed, thu).days).toHaveLength(5);
  });

  it("'first Wednesday' becomes 'second Friday'", () => {
    expect(followStart(presetRule("monthlyNth", wed), wed, new Date(2026, 10, 13)).nth).toBe(2);
  });
});

describe("trimming a series before an occurrence", () => {
  it("timed event: UNTIL a second earlier, COUNT removed", () => {
    const split = new Date(2026, 10, 18, 9, 0);
    const lines = truncateBefore(["RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=10", "EXDATE:20261111T090000Z"], split, false);
    expect(lines).toEqual([
      `RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=${utcStamp(new Date(2026, 10, 18, 8, 59, 59))}`,
      "EXDATE:20261111T090000Z",
    ]);
    expect(keys(occurrences(rule(lines) as Rule, wed, new Date(2027, 0, 1)))).toEqual(["2026-11-04", "2026-11-11"]);
  });

  it("all-day event: UNTIL is the previous day", () => {
    expect(truncateBefore(["RRULE:FREQ=DAILY;UNTIL=20270101"], new Date(2026, 10, 10), true)).toEqual([
      "RRULE:FREQ=DAILY;UNTIL=20261109",
    ]);
  });
});

describe("occurrences", () => {
  it("every two weeks on Mondays and Wednesdays", () => {
    const r = rule(["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE"]) as Rule;
    expect(keys(occurrences(r, wed, new Date(2026, 10, 30)))).toEqual(["2026-11-04", "2026-11-16", "2026-11-18"]);
  });

  it("last Friday of the month and occurrence count", () => {
    const fri = new Date(2026, 10, 27, 18, 0);
    const r = rule(["RRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=3"], fri) as Rule;
    expect(keys(occurrences(r, fri, new Date(2028, 0, 1)))).toEqual(["2026-11-27", "2026-12-25", "2027-01-29"]);
  });

  it("monthly on the 31st skips short months", () => {
    const start = new Date(2026, 0, 31);
    expect(keys(occurrences(presetRule("monthly", start), start, new Date(2026, 4, 1)))).toEqual([
      "2026-01-31",
      "2026-03-31",
    ]);
  });
});

const plain = (s: string) => s.replace(/[  ]/g, " ");

describe("rule description", () => {
  it("in Russian", () => {
    expect(describeRule(presetRule("weekdays", wed), wed)).toBe("По будням");
    expect(describeRule(rule(["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20261231"]), wed)).toBe(
      "Раз в 2 недели, по пн и ср, до 31 декабря 2026",
    );
    expect(describeRule(presetRule("monthlyNth", new Date(2026, 10, 10)), new Date(2026, 10, 10))).toBe(
      "Каждый месяц, во второй вторник",
    );
    expect(describeRule(presetRule("monthlyNth", new Date(2026, 10, 30)), new Date(2026, 10, 30))).toBe(
      "Каждый месяц, в последний понедельник",
    );
    expect(describeRule(rule(["RRULE:FREQ=DAILY;COUNT=3"]), wed)).toBe("Каждый день, 3 раза");
    expect(describeRule(null, wed)).toBe("Особый повтор, настроенный в Google");
  });

  it("in English", () => {
    setLang("en", "en-GB");
    expect(describeRule(presetRule("monthlyNth", wed), wed)).toBe("Monthly, on the first Wednesday");
    expect(plain(describeRule(presetRule("yearly", wed), wed))).toBe("Annually, on 4 November");
    expect(describeRule(rule(["RRULE:FREQ=DAILY;INTERVAL=3;COUNT=1"]), wed)).toBe("Every 3 days, once");
  });
});
