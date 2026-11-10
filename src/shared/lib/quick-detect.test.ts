// The phrase is read in the language it is written in, not only in the interface language
import { describe, expect, it } from "vitest";
import { parseQuick } from "./quick";
import { phraseLang } from "./quick-detect";

// Tuesday 10 November 2026, 19:50
const now = new Date(2026, 10, 10, 19, 50);
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m);

describe("language of the phrase", () => {
  it("the interface language when the phrase is in its script", () => {
    expect(phraseLang("завтра 19:00 спорт", "ru")).toBe("ru");
    expect(phraseLang("mañana 19:00 clase", "es")).toBe("es");
    expect(phraseLang("明日19時 英会話", "ja")).toBe("ja");
    expect(phraseLang("12:00", "de")).toBe("de");
  });

  it("another script picks the language of that script", () => {
    expect(phraseLang("занятие спортом в 12:00", "en")).toBe("ru");
    expect(phraseLang("tomorrow 7pm gym", "ru")).toBe("en");
    expect(phraseLang("明天晚上7点 英语课", "en")).toBe("zh");
    expect(phraseLang("明日19時 えいご", "zh")).toBe("ja");
    expect(phraseLang("غدًا الساعة 7", "en")).toBe("ar");
    expect(phraseLang("कल शाम 7 बजे", "en")).toBe("hi");
    expect(phraseLang("কাল সন্ধ্যা 7টায়", "en")).toBe("bn");
  });

  it("a Russian phrase with the English interface", () => {
    const r = parseQuick("занятие спортом в 12:00", now, [], "en");
    expect(r).toMatchObject({ title: "занятие спортом", start: at(11, 12), end: at(11, 13) });
  });
});

describe("day of the month alone (Russian)", () => {
  it("«, 14» at the end, «14-го», «14 числа»", () => {
    expect(parseQuick("занятие спортом в 12:00, 14", now, [], "ru")).toMatchObject({
      title: "занятие спортом",
      start: at(14, 12),
    });
    expect(parseQuick("врач 14-го в 9:00", now, [], "ru")).toMatchObject({ title: "врач", start: at(14, 9) });
    expect(parseQuick("стрижка 20 числа", now, [], "ru")).toMatchObject({ title: "стрижка", allDay: true, start: at(20, 0) });
  });

  it("a day already gone is in the next month", () => {
    expect(parseQuick("оплата 5 числа", now, [], "ru").start).toEqual(new Date(2026, 11, 5));
  });

  it("numbers inside the title stay", () => {
    expect(parseQuick("купить 2 билета", now, [], "ru").title).toBe("купить 2 билета");
    expect(parseQuick("встреча, 2 человека", now, [], "ru").title).toBe("встреча, 2 человека");
  });
});
