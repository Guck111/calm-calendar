import { describe, expect, it } from "vitest";
import { parseQuick } from "./quick";

// серада, 4 лістапада 2026, 18:00
const now = new Date(2026, 10, 4, 18, 0);
const calendars = [
  { id: "me", name: "Асабістае" },
  { id: "work", name: "Праца" },
];
const at = (d: number, h: number, m = 0, month = 10) => new Date(2026, month, d, h, m);
const be = (text: string) => parseQuick(text, now, calendars, "be");

describe("хуткае стварэнне па-беларуску", () => {
  it("заўтра, час і працягласць", () => {
    expect(be("заўтра 19:00 англійская 50 хв")).toMatchObject({
      title: "англійская",
      allDay: false,
      start: at(5, 19),
      end: at(5, 19, 50),
    });
    expect(be("заўтра а 9 стэндап #пра @Офіс_Няміга паўгадзіны")).toMatchObject({
      title: "стэндап",
      calendarId: "work",
      location: "Офіс Няміга",
      start: at(5, 9),
      end: at(5, 9, 30),
    });
  });

  it("часткі сутак і прамежкі", () => {
    expect(be("у пятніцу а 7 вечара вячэра")).toMatchObject({ title: "вячэра", start: at(6, 19) });
    expect(be("званок з 14 да 15:30")).toMatchObject({ title: "званок", start: at(5, 14), end: at(5, 15, 30) });
    expect(be("сёння 19-21 кіно")).toMatchObject({ title: "кіно", start: at(4, 19), end: at(4, 21) });
  });

  it("дні тыдня, даты і лічбы", () => {
    expect(be("ср у 20 трэніроўка").start).toEqual(at(4, 20));
    expect(be("нд дзень нараджэння Алеся")).toMatchObject({ title: "дзень нараджэння Алеся", allDay: true, start: at(8, 0) });
    expect(be("5 снежня 10:00 доктар").start).toEqual(at(5, 10, 0, 11));
    expect(be("12.11 стрыжка")).toMatchObject({ title: "стрыжка", allDay: true, start: at(12, 0) });
    expect(be("праз 3 дні 12:00 абед").start).toEqual(at(7, 12));
    expect(be("пт 18 кіно")).toMatchObject({ title: "кіно", start: at(6, 18) });
    expect(be("урок заўтра 10:00 1,5 гадзіны").end).toEqual(at(5, 11, 30));
  });
});
