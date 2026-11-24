import { describe, expect, it } from "vitest";
import { parseQuickAr } from "./quick-ar";
import { parseQuickHi } from "./quick-hi";

// Wednesday, November 4, 2026, 18:00
const now = new Date(2026, 10, 4, 18, 0);
const at = (d: number, h = 0, m = 0, month = 10, y = 2026) => new Date(y, month, d, h, m);
const hi = (input: string) => parseQuickHi(input, now, []);
const ar = (input: string) => parseQuickAr(input, now, []);

describe("Hindi quick add: dates", () => {
  it("today keeps a passed time, tonight turns a bare hour into the evening", () => {
    expect(hi("आज 10 बजे मीटिंग").start).toEqual(at(4, 10));
    expect(hi("आज रात को 8 बजे फिल्म")).toMatchObject({ title: "फिल्म", start: at(4, 20) });
  });

  it("in some weeks, January, a Latin month in capitals", () => {
    expect(hi("2 हफ्ते बाद रिव्यू").start).toEqual(at(18));
    expect(hi("5 जनवरी मीटिंग").start).toEqual(at(5, 0, 0, 0, 2027));
    expect(hi("5 NOV मीटिंग").start).toEqual(at(5));
  });

  it("a title with the word 'undefined' is not a weekday", () => {
    expect(hi("undefined भाषण").start).toEqual(at(4));
  });
});

describe("Hindi quick add: times", () => {
  it("a part of the day or a half or quarter marks a time even without बजे", () => {
    expect(hi("कल शाम 7 पार्टी").start).toEqual(at(5, 19));
    expect(hi("कल साढ़े 7 नाश्ता").start).toEqual(at(5, 7, 30));
    expect(hi("कल सवा 9 बस").start).toEqual(at(5, 9, 15));
    expect(hi("कल पौने 8 ट्रेन").start).toEqual(at(5, 7, 45));
  });

  it("one and a half and two and a half o'clock", () => {
    expect(hi("कल डेढ़ बजे लंच").start).toEqual(at(5, 1, 30));
    expect(hi("कल ढाई बजे लंच").start).toEqual(at(5, 2, 30));
  });

  it("12 in the morning and at night is midnight, 6 at night is 18:00, आधी रात is midnight", () => {
    expect(hi("कल सुबह 12 बजे उड़ान").start).toEqual(at(5, 0));
    expect(hi("कल रात 12 बजे उड़ान").start).toEqual(at(5, 0));
    expect(hi("कल रात 6 बजे खाना").start).toEqual(at(5, 18));
    expect(hi("कल आधी रात को रिलीज़")).toMatchObject({ allDay: false, start: at(5, 0) });
  });

  it("a range needs only one side marked as a time", () => {
    expect(hi("कल 7 से 9 बजे तक पार्टी")).toMatchObject({ start: at(5, 7), end: at(5, 9) });
  });

  it("a part of the day before hours of duration is not a time", () => {
    expect(hi("कल शाम 2 घंटे योग").allDay).toBe(true);
  });

  it("impossible ranges and hours leave the event all-day", () => {
    expect(hi("कल 9 से 25 बजे पार्टी").allDay).toBe(true);
    expect(hi("कल 25 बजे पार्टी").allDay).toBe(true);
  });
});

describe("Hindi quick add: durations", () => {
  it("for some hours, two and a half hours, fractional hours", () => {
    expect(hi("कल 9 बजे मीटिंग 2 घंटे के लिए")).toMatchObject({ title: "मीटिंग", end: at(5, 11) });
    expect(hi("कल 9 बजे वर्कशॉप साढ़े 2 घंटे").end).toEqual(at(5, 11, 30));
    expect(hi("कल 9 बजे वर्कशॉप 1,5 घंटे").end).toEqual(at(5, 10, 30));
  });
});

describe("Arabic quick add", () => {
  it("Sunday is a weekday", () => {
    expect(ar("الأحد مباراة").start).toEqual(at(8));
  });

  it("dual numbers of minutes and weeks", () => {
    expect(ar("غدا الساعة 9 مكالمة دقيقتين").end).toEqual(at(5, 9, 2));
    expect(ar("بعد أسبوعين مراجعة").start).toEqual(at(18));
  });

  it("'for' before a duration and a dangling preposition are dropped from the title", () => {
    expect(ar("غدا الساعة 9 اجتماع مدة ساعتين")).toMatchObject({ title: "اجتماع", end: at(5, 11) });
    expect(ar("غدا اجتماع في").title).toBe("اجتماع");
  });
});
