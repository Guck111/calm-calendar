import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "../api/types";
import { eventsForDay, layoutDay } from "./layout";

const ev = (id: string, start: Date, end: Date, allDay = false): CalendarEvent => ({
  key: id,
  id,
  calendarId: "c",
  title: id,
  start,
  end,
  allDay,
  recurring: false,
});

const at = (h: number, m = 0, day = 4) => new Date(2026, 10, day, h, m);
const day = new Date(2026, 10, 4);

describe("раскладка дня", () => {
  it("непересекающиеся события занимают всю ширину", () => {
    const placed = layoutDay([ev("a", at(9), at(10)), ev("b", at(10), at(11))], day);
    expect(placed.map((p) => [p.event.id, p.column, p.columns])).toEqual([
      ["a", 0, 1],
      ["b", 0, 1],
    ]);
  });

  it("пересекающиеся делят ширину, освободившаяся колонка переиспользуется", () => {
    const placed = layoutDay(
      [ev("a", at(9), at(12)), ev("b", at(9, 30), at(10)), ev("c", at(10), at(11))],
      day,
    );
    const byId = Object.fromEntries(placed.map((p) => [p.event.id, p]));
    expect(byId.a.column).toBe(0);
    expect(byId.b.column).toBe(1);
    expect(byId.c.column).toBe(1);
    expect(placed.every((p) => p.columns === 2)).toBe(true);
  });

  it("событие через полночь обрезается границами дня", () => {
    const [p] = layoutDay([ev("n", at(22, 0, 3), at(2, 0, 4))], day);
    expect([p.startMin, p.endMin]).toEqual([0, 120]);
  });

  it("событие на весь день не попадает в сетку времени, но попадает в список дня", () => {
    const allDay = ev("x", new Date(2026, 10, 4), new Date(2026, 10, 5), true);
    expect(layoutDay([allDay], day)).toHaveLength(0);
    expect(eventsForDay([allDay], day)).toHaveLength(1);
    // конец не включительно: на следующий день событие не переходит
    expect(eventsForDay([allDay], new Date(2026, 10, 5))).toHaveLength(0);
  });

  it("очень короткое событие получает минимальную высоту", () => {
    const [p] = layoutDay([ev("s", at(9), at(9, 5))], day);
    expect(p.endMin - p.startMin).toBe(20);
  });
});
