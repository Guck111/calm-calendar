import { describe, expect, it } from "vitest";
import { parseQuick } from "./quick";

// среда, 4 ноября 2026, 18:00
const now = new Date(2026, 10, 4, 18, 0);
const calendars = [
  { id: "me", name: "Личное" },
  { id: "work", name: "Работа" },
  { id: "pl", name: "Польский язык" },
];

const at = (d: number, h: number, m = 0, month = 10) => new Date(2026, month, d, h, m);

describe("быстрое создание", () => {
  it("завтра, время и длительность", () => {
    const r = parseQuick("завтра 19:00 английский 50 мин", now);
    expect(r).toMatchObject({ title: "английский", allDay: false, start: at(5, 19), end: at(5, 19, 50) });
  });

  it("промежуток «с … до …» и «19-21»", () => {
    expect(parseQuick("созвон с 14 до 15:30", now)).toMatchObject({ title: "созвон", start: at(5, 14), end: at(5, 15, 30) });
    expect(parseQuick("сегодня 19-21 кино", now)).toMatchObject({ title: "кино", start: at(4, 19), end: at(4, 21) });
  });

  it("день недели — ближайший, включая сегодня; «в 7 вечера» — 19:00", () => {
    expect(parseQuick("в пятницу в 7 вечера ужин", now)).toMatchObject({ title: "ужин", start: at(6, 19) });
    expect(parseQuick("ср в 20 тренировка", now).start).toEqual(at(4, 20));
  });

  it("без времени — событие на весь день", () => {
    const r = parseQuick("сб день рождения Таши", now);
    expect(r).toMatchObject({ title: "день рождения Таши", allDay: true, start: at(7, 0), end: at(8, 0) });
  });

  it("дата словами и через точку; прошедшая дата без года — в следующем году", () => {
    expect(parseQuick("5 декабря 10:00 врач", now).start).toEqual(at(5, 10, 0, 11));
    expect(parseQuick("12.11 стрижка", now)).toMatchObject({ title: "стрижка", allDay: true, start: at(12, 0) });
    expect(parseQuick("1 марта отпуск", now).start).toEqual(new Date(2027, 2, 1));
  });

  it("время без даты, которое уже прошло, — завтра", () => {
    expect(parseQuick("8:00 зарядка", now).start).toEqual(at(5, 8));
    expect(parseQuick("в 19.30 прогулка", now).start).toEqual(at(4, 19, 30));
  });

  it("метки календаря и места; полчаса и часы с дробью", () => {
    const r = parseQuick("завтра 9:00 стендап #раб @Офис_Гдыня полчаса", now, calendars);
    expect(r).toMatchObject({ title: "стендап", calendarId: "work", location: "Офис Гдыня", end: at(5, 9, 30) });
    expect(parseQuick("завтра 10:00 урок 1,5 часа #польск", now, calendars)).toMatchObject({
      calendarId: "pl",
      end: at(5, 11, 30),
    });
  });

  it("через N дней и событие через полночь", () => {
    expect(parseQuick("через 3 дня 12:00 обед", now).start).toEqual(at(7, 12));
    expect(parseQuick("сегодня 23:00-1:00 фильм", now).end).toEqual(at(5, 1));
  });

  it("числа внутри названия не трогаются", () => {
    expect(parseQuick("купить 2 билета", now)).toMatchObject({ title: "купить 2 билета", allDay: true });
  });
});

describe("быстрое создание: точка в дате и времени", () => {
  it("«в 10.30» — время, «10.11» — дата", () => {
    expect(parseQuick("завтра в 10.30 врач", now).start).toEqual(at(5, 10, 30));
    expect(parseQuick("10.11 врач", now)).toMatchObject({ allDay: true, start: at(10, 0) });
  });
});

describe("быстрое создание: час сразу после дня", () => {
  it("«пт 18 кино 2 ч» и «завтра 9 зарядка»", () => {
    expect(parseQuick("пт 18 кино 2 ч", now)).toMatchObject({ title: "кино", start: at(6, 18), end: at(6, 20) });
    expect(parseQuick("завтра 9 зарядка", now)).toMatchObject({ title: "зарядка", start: at(5, 9) });
  });

  it("число с единицей после дня — не час", () => {
    expect(parseQuick("завтра 2 ч уборка", now)).toMatchObject({ allDay: true, title: "уборка" });
    expect(parseQuick("сегодня 5 дней отпуска", now).title).toBe("5 дней отпуска");
  });
});
