import { describe, expect, it } from "vitest";
import { parseQuick } from "./quick";

// середа, 4 листопада 2026, 18:00
const now = new Date(2026, 10, 4, 18, 0);
const calendars = [
  { id: "me", name: "Особисте" },
  { id: "work", name: "Робота" },
];
const at = (d: number, h: number, m = 0, month = 10) => new Date(2026, month, d, h, m);
const uk = (text: string) => parseQuick(text, now, calendars, "uk");

describe("швидке створення українською", () => {
  it("завтра, час і тривалість", () => {
    expect(uk("завтра 19:00 англійська 50 хв")).toMatchObject({
      title: "англійська",
      allDay: false,
      start: at(5, 19),
      end: at(5, 19, 50),
    });
    expect(uk("завтра о 9 стендап #роб @Офіс_Поділ півгодини")).toMatchObject({
      title: "стендап",
      calendarId: "work",
      location: "Офіс Поділ",
      start: at(5, 9),
      end: at(5, 9, 30),
    });
  });

  it("частини доби і проміжки", () => {
    expect(uk("у п'ятницю о 7 вечора вечеря")).toMatchObject({ title: "вечеря", start: at(6, 19) });
    expect(uk("в п’ятницю об 11 лікар").start).toEqual(at(6, 11));
    expect(uk("дзвінок з 14 до 15:30")).toMatchObject({ title: "дзвінок", start: at(5, 14), end: at(5, 15, 30) });
    expect(uk("сьогодні 19-21 кіно")).toMatchObject({ title: "кіно", start: at(4, 19), end: at(4, 21) });
  });

  it("дні тижня, дати і числа", () => {
    expect(uk("ср о 20 тренування").start).toEqual(at(4, 20));
    expect(uk("нд день народження Тараса")).toMatchObject({ title: "день народження Тараса", allDay: true, start: at(8, 0) });
    expect(uk("5 грудня 10:00 лікар").start).toEqual(at(5, 10, 0, 11));
    expect(uk("12.11 стрижка")).toMatchObject({ title: "стрижка", allDay: true, start: at(12, 0) });
    expect(uk("через 3 дні 12:00 обід").start).toEqual(at(7, 12));
    expect(uk("пт 18 кіно")).toMatchObject({ title: "кіно", start: at(6, 18) });
    expect(uk("урок завтра 10:00 1,5 години").end).toEqual(at(5, 11, 30));
  });
});
