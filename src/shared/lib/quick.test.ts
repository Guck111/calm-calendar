import { describe, expect, it } from "vitest";
import { parseQuick } from "./quick";

// Wednesday, November 4, 2026, 18:00
const now = new Date(2026, 10, 4, 18, 0);
const calendars = [
  { id: "me", name: "Личное" },
  { id: "work", name: "Работа" },
  { id: "pl", name: "Польский язык" },
];

const at = (d: number, h: number, m = 0, month = 10) => new Date(2026, month, d, h, m);

describe("quick add", () => {
  it("tomorrow, time and duration", () => {
    const r = parseQuick("завтра 19:00 английский 50 мин", now);
    expect(r).toMatchObject({ title: "Английский", allDay: false, start: at(5, 19), end: at(5, 19, 50) });
  });

  it("range 'с … до …' and '19-21'", () => {
    expect(parseQuick("созвон с 14 до 15:30", now)).toMatchObject({ title: "Созвон", start: at(5, 14), end: at(5, 15, 30) });
    expect(parseQuick("сегодня 19-21 кино", now)).toMatchObject({ title: "Кино", start: at(4, 19), end: at(4, 21) });
  });

  it("weekday — the nearest one, including today; 'в 7 вечера' is 19:00", () => {
    expect(parseQuick("в пятницу в 7 вечера ужин", now)).toMatchObject({ title: "Ужин", start: at(6, 19) });
    expect(parseQuick("ср в 20 тренировка", now).start).toEqual(at(4, 20));
  });

  it("no time — an all-day event", () => {
    const r = parseQuick("сб день рождения Таши", now);
    expect(r).toMatchObject({ title: "День рождения Таши", allDay: true, start: at(7, 0), end: at(8, 0) });
  });

  it("date in words and with a dot; a past date without a year goes to next year", () => {
    expect(parseQuick("5 декабря 10:00 врач", now).start).toEqual(at(5, 10, 0, 11));
    expect(parseQuick("12.11 стрижка", now)).toMatchObject({ title: "Стрижка", allDay: true, start: at(12, 0) });
    expect(parseQuick("1 марта отпуск", now).start).toEqual(new Date(2027, 2, 1));
  });

  it("a time without a date that has already passed is tomorrow", () => {
    expect(parseQuick("8:00 зарядка", now).start).toEqual(at(5, 8));
    expect(parseQuick("в 19.30 прогулка", now).start).toEqual(at(4, 19, 30));
  });

  it("calendar and location tags; half an hour and fractional hours", () => {
    const r = parseQuick("завтра 9:00 стендап #раб @Офис_Гдыня полчаса", now, calendars);
    expect(r).toMatchObject({ title: "Стендап", calendarId: "work", location: "Офис Гдыня", end: at(5, 9, 30) });
    expect(parseQuick("завтра 10:00 урок 1,5 часа #польск", now, calendars)).toMatchObject({
      calendarId: "pl",
      end: at(5, 11, 30),
    });
  });

  it("in N days and an event across midnight", () => {
    expect(parseQuick("через 3 дня 12:00 обед", now).start).toEqual(at(7, 12));
    expect(parseQuick("сегодня 23:00-1:00 фильм", now).end).toEqual(at(5, 1));
  });

  it("numbers inside the title are left alone", () => {
    expect(parseQuick("купить 2 билета", now)).toMatchObject({ title: "Купить 2 билета", allDay: true });
  });
});

describe("quick add: the title starts with a capital letter", () => {
  it("only the first letter changes, names inside stay as typed", () => {
    expect(parseQuick("завтра 19:00 ужин с Олей", now).title).toBe("Ужин с Олей");
    expect(parseQuick("tomorrow 7pm call with Ola", now, [], "en").title).toBe("Call with Ola");
    expect(parseQuick("morgen 19 Uhr ölwechsel", now, [], "de").title).toBe("Ölwechsel");
  });

  it("a first word with its own capitals, a digit or a script without cases is left alone", () => {
    expect(parseQuick("tomorrow iPhone repair", now, [], "en").title).toBe("iPhone repair");
    expect(parseQuick("купить 2 билета", now).title).toBe("Купить 2 билета");
    expect(parseQuick("сегодня 5 дней отпуска", now).title).toBe("5 дней отпуска");
    expect(parseQuick("明日19時 英会話", now, [], "ja").title).toBe("英会話");
  });

  it("a phrase without a title keeps an empty title", () => {
    expect(parseQuick("завтра 19:00", now).title).toBe("");
  });
});

describe("quick add: dot in date and time", () => {
  it("'в 10.30' is a time, '10.11' is a date", () => {
    expect(parseQuick("завтра в 10.30 врач", now).start).toEqual(at(5, 10, 30));
    expect(parseQuick("10.11 врач", now)).toMatchObject({ allDay: true, start: at(10, 0) });
  });
});

describe("quick add: hour right after the day", () => {
  it("'пт 18 кино 2 ч' and 'завтра 9 зарядка'", () => {
    expect(parseQuick("пт 18 кино 2 ч", now)).toMatchObject({ title: "Кино", start: at(6, 18), end: at(6, 20) });
    expect(parseQuick("завтра 9 зарядка", now)).toMatchObject({ title: "Зарядка", start: at(5, 9) });
  });

  it("a number with a unit after the day is not an hour", () => {
    expect(parseQuick("завтра 2 ч уборка", now)).toMatchObject({ allDay: true, title: "Уборка" });
    expect(parseQuick("сегодня 5 дней отпуска", now).title).toBe("5 дней отпуска");
  });
});
