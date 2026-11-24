import { describe, expect, it } from "vitest";
import { kanjiToDigits } from "./quick-cjk";
import { parseQuickJa } from "./quick-ja";
import { parseQuickZh } from "./quick-zh";

// Wednesday, November 4, 2026, 18:00
const now = new Date(2026, 10, 4, 18, 0);
const at = (d: number, h = 0, m = 0, month = 10) => new Date(2026, month, d, h, m);
const zh = (input: string) => parseQuickZh(input, now, []);
const ja = (input: string) => parseQuickJa(input, now, []);

describe("CJK numbers in ideographs", () => {
  it("tens with and without a digit before or after", () => {
    expect(kanjiToDigits("十二点")).toBe("12点");
    expect(kanjiToDigits("二十三点")).toBe("23点");
    expect(kanjiToDigits("二十点")).toBe("20点");
    expect(kanjiToDigits("二三点")).toBe("23点");
  });
});

describe("CJK quick add: dates", () => {
  it("today keeps a time that has passed", () => {
    expect(zh("今天10点开会").start).toEqual(at(4, 10));
  });

  it("a day of the month is this month from today on, otherwise the next month", () => {
    expect(zh("5号开会").start).toEqual(at(5));
    expect(zh("4号开会").start).toEqual(at(4));
    expect(zh("3号开会").start).toEqual(at(3, 0, 0, 11));
  });
});

describe("CJK quick add: times", () => {
  it("12 before dawn is midnight, 12 at midday stays noon, and noon itself is a time", () => {
    expect(zh("明天凌晨12点航班").start).toEqual(at(5, 0));
    expect(zh("明天中午12点午饭").start).toEqual(at(5, 12));
    expect(zh("明天正午开会")).toMatchObject({ allDay: false, start: at(5, 12) });
  });

  it("impossible ranges and hours leave the event all-day", () => {
    expect(zh("明天9点-25点会议").allDay).toBe(true);
    expect(zh("明天25点会议").allDay).toBe(true);
  });

  it("fractional hours with a comma", () => {
    expect(zh("明天9点开会1,5小时").end).toEqual(at(5, 10, 30));
  });
});

describe("CJK quick add: title", () => {
  it("particles are dropped at both edges of a title piece", () => {
    expect(ja("明日の会議を").title).toBe("会議");
  });
});
