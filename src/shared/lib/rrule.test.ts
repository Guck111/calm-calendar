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

// среда, 4 ноября 2026, 9:00 по местному времени
const wed = new Date(2026, 10, 4, 9, 0);
const rule = (lines: string[], start = wed) => parseRecurrence(lines, start).rule;
const keys = (dates: Date[]) => dates.map(toDateKey);

describe("разбор правила", () => {
  it("понимает частоту, шаг, дни недели и конец", () => {
    expect(rule(["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10"])).toEqual({
      freq: "WEEKLY",
      interval: 2,
      days: ["MO", "WE"],
      end: { kind: "count", count: 10 },
    });
    expect(rule(["RRULE:FREQ=DAILY;UNTIL=20261231"])?.end).toEqual({ kind: "until", date: "2026-12-31" });
  });

  it("без BYDAY еженедельное правило повторяется в день начала", () => {
    expect(rule(["RRULE:FREQ=WEEKLY"])?.days).toEqual(["WE"]);
  });

  it("UNTIL в UTC переводит в местный день", () => {
    const end = new Date(2026, 11, 31, 23, 59, 59);
    expect(rule([`RRULE:FREQ=DAILY;UNTIL=${utcStamp(end)}`])?.end).toEqual({ kind: "until", date: "2026-12-31" });
  });

  it("n-й день недели месяца — только если совпадает с началом", () => {
    expect(rule(["RRULE:FREQ=MONTHLY;BYDAY=1WE"])?.nth).toBe(1);
    expect(rule(["RRULE:FREQ=MONTHLY;BYDAY=2WE"])).toBeNull();
    // 25 ноября 2026 — последняя среда месяца
    expect(rule(["RRULE:FREQ=MONTHLY;BYDAY=-1WE"], new Date(2026, 10, 25))?.nth).toBe(-1);
  });

  it("сложные правила не правим, но строки EXDATE сохраняем", () => {
    const parsed = parseRecurrence(["RRULE:FREQ=MONTHLY;BYSETPOS=-1;BYDAY=MO,TU", "EXDATE:20261111T090000Z"], wed);
    expect(parsed.rule).toBeNull();
    expect(parsed.extra).toEqual(["EXDATE:20261111T090000Z"]);
    expect(rule(["RRULE:FREQ=DAILY;COUNT=2;UNTIL=20261231"])).toBeNull();
    expect(rule(["RRULE:FREQ=MONTHLY;BYMONTHDAY=5"])).toBeNull();
    expect(rule(["RRULE:FREQ=MONTHLY;BYMONTHDAY=4"])).not.toBeNull();
  });
});

describe("сборка правила", () => {
  it("туда и обратно без потерь", () => {
    const r: Rule = { freq: "WEEKLY", interval: 2, days: ["FR", "MO"], end: { kind: "count", count: 5 } };
    const line = formatRule(r, wed, false);
    expect(line).toBe("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR;COUNT=5");
    expect(rule([line])).toEqual({ ...r, days: ["MO", "FR"] });
  });

  it("UNTIL: дата для события на весь день, конец дня в UTC для события со временем", () => {
    const r: Rule = { freq: "DAILY", interval: 1, days: [], end: { kind: "until", date: "2026-12-31" } };
    expect(formatRule(r, wed, true)).toBe("RRULE:FREQ=DAILY;UNTIL=20261231");
    expect(formatRule(r, wed, false)).toBe(`RRULE:FREQ=DAILY;UNTIL=${utcStamp(new Date(2026, 11, 31, 23, 59, 59))}`);
  });

  it("n-й день недели пишется через BYDAY", () => {
    expect(buildRecurrence(presetRule("monthlyNth", wed), ["EXDATE:x"], wed, false)).toEqual([
      "RRULE:FREQ=MONTHLY;BYDAY=1WE",
      "EXDATE:x",
    ]);
    expect(buildRecurrence(null, ["EXDATE:x"], wed, false)).toEqual([]);
  });
});

describe("готовые варианты", () => {
  it("узнаёт вариант по правилу из Google", () => {
    expect(presetOf(rule(["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"]) as Rule, wed)).toBe("weekdays");
    expect(presetOf(rule(["RRULE:FREQ=WEEKLY;BYDAY=WE"]) as Rule, wed)).toBe("weekly");
    expect(presetOf(rule(["RRULE:FREQ=YEARLY"]) as Rule, wed)).toBe("yearly");
    expect(presetOf(rule(["RRULE:FREQ=DAILY;COUNT=3"]) as Rule, wed)).toBeNull();
  });

  it("пятый день недели месяца становится последним", () => {
    // 30 ноября 2026 — пятый и последний понедельник
    expect(presetRule("monthlyNth", new Date(2026, 10, 30)).nth).toBe(-1);
  });
});

describe("сдвиг начала", () => {
  it("«каждую среду» становится «каждым четвергом»", () => {
    const thu = new Date(2026, 10, 5, 9, 0);
    expect(followStart(presetRule("weekly", wed), wed, thu).days).toEqual(["TH"]);
    // несколько дней недели не трогаем
    expect(followStart(presetRule("weekdays", wed), wed, thu).days).toHaveLength(5);
  });

  it("«первая среда» становится «второй пятницей»", () => {
    expect(followStart(presetRule("monthlyNth", wed), wed, new Date(2026, 10, 13)).nth).toBe(2);
  });
});

describe("обрезка серии перед повторением", () => {
  it("событие со временем: UNTIL на секунду раньше, COUNT убирается", () => {
    const split = new Date(2026, 10, 18, 9, 0);
    const lines = truncateBefore(["RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=10", "EXDATE:20261111T090000Z"], split, false);
    expect(lines).toEqual([
      `RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=${utcStamp(new Date(2026, 10, 18, 8, 59, 59))}`,
      "EXDATE:20261111T090000Z",
    ]);
    expect(keys(occurrences(rule(lines) as Rule, wed, new Date(2027, 0, 1)))).toEqual(["2026-11-04", "2026-11-11"]);
  });

  it("событие на весь день: UNTIL — предыдущий день", () => {
    expect(truncateBefore(["RRULE:FREQ=DAILY;UNTIL=20270101"], new Date(2026, 10, 10), true)).toEqual([
      "RRULE:FREQ=DAILY;UNTIL=20261109",
    ]);
  });
});

describe("повторения", () => {
  it("раз в две недели по понедельникам и средам", () => {
    const r = rule(["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE"]) as Rule;
    expect(keys(occurrences(r, wed, new Date(2026, 10, 30)))).toEqual(["2026-11-04", "2026-11-16", "2026-11-18"]);
  });

  it("последняя пятница месяца и число повторов", () => {
    const fri = new Date(2026, 10, 27, 18, 0);
    const r = rule(["RRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=3"], fri) as Rule;
    expect(keys(occurrences(r, fri, new Date(2028, 0, 1)))).toEqual(["2026-11-27", "2026-12-25", "2027-01-29"]);
  });

  it("каждый месяц 31-го пропускает короткие месяцы", () => {
    const start = new Date(2026, 0, 31);
    expect(keys(occurrences(presetRule("monthly", start), start, new Date(2026, 4, 1)))).toEqual([
      "2026-01-31",
      "2026-03-31",
    ]);
  });
});

const plain = (s: string) => s.replace(/[  ]/g, " ");

describe("описание правила", () => {
  it("по-русски", () => {
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
