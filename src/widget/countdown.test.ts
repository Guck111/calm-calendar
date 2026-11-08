import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "../shared/api/types";
import { countdown } from "./countdown";

const at = (h: number, m = 0, d = 4) => new Date(2026, 10, d, h, m);
const ev = (title: string, start: Date, end: Date, allDay = false): CalendarEvent => ({
  key: title, id: title, calendarId: "c", title, start, end, allDay, recurring: false,
});

describe("обратный отсчёт", () => {
  it("ближайшее событие: часы и минуты", () => {
    expect(countdown([ev("Muay Thai", at(20), at(22))], at(18, 35))).toMatchObject({ title: "Muay Thai", text: "через 1 ч 25 мин" });
  });

  it("идущее событие показывает, сколько осталось", () => {
    expect(countdown([ev("Работа", at(12), at(18))], at(15, 50))?.text).toBe("идёт, ещё 2 ч 10 мин");
  });

  it("скорое следующее важнее текущего", () => {
    const list = [ev("Работа", at(12), at(18)), ev("Урок", at(18), at(19))];
    expect(countdown(list, at(17, 45))).toMatchObject({ title: "Урок", text: "через 15 мин" });
  });

  it("события на весь день и слишком далёкие не показываем", () => {
    expect(countdown([ev("Отпуск", at(0), at(0, 0, 5), true)], at(10))).toBeNull();
    expect(countdown([ev("Завтра", at(9, 0, 6), at(10, 0, 6))], at(10))).toBeNull();
  });
});
