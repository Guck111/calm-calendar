import { describe, expect, it } from "vitest";
import {
  addMonths,
  combineDateTime,
  monthGrid,
  shiftCursor,
  startOfWeek,
  toDateKey,
  viewRange,
  viewTitle,
} from "./date";

describe("даты", () => {
  it("неделя начинается с понедельника, в том числе от воскресенья", () => {
    expect(toDateKey(startOfWeek(new Date(2026, 10, 8)))).toBe("2026-11-02");
    expect(toDateKey(startOfWeek(new Date(2026, 10, 2)))).toBe("2026-11-02");
  });

  it("сетка месяца — 42 дня с понедельника, содержит весь месяц", () => {
    const grid = monthGrid(new Date(2026, 10, 15));
    expect(grid).toHaveLength(42);
    expect(toDateKey(grid[0])).toBe("2026-10-26");
    expect(grid.some((d) => toDateKey(d) === "2026-11-30")).toBe(true);
  });

  it("перелистывание месяца не перескакивает через короткий месяц", () => {
    expect(toDateKey(addMonths(new Date(2026, 0, 31), 1))).toBe("2026-02-28");
    expect(toDateKey(shiftCursor("month", new Date(2026, 2, 31), -1))).toBe("2026-02-28");
  });

  it("диапазон недели — 7 полных дней", () => {
    const r = viewRange("week", new Date(2026, 10, 4, 15, 0));
    expect(toDateKey(r.start)).toBe("2026-11-02");
    expect(toDateKey(r.end)).toBe("2026-11-09");
    expect(r.start.getHours()).toBe(0);
  });

  it("сутки при переходе на зимнее время остаются календарными", () => {
    // в Европе 25 октября 2026 переход на зимнее время
    const r = viewRange("day", new Date(2026, 9, 25, 12));
    expect(toDateKey(r.end)).toBe("2026-10-26");
    expect(r.end.getHours()).toBe(0);
  });

  it("дата и время из полей формы собираются в местное время", () => {
    const d = combineDateTime("2026-11-04", "18:30");
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([
      2026, 10, 4, 18, 30,
    ]);
  });

  it("заголовок недели в пределах одного месяца", () => {
    expect(viewTitle("week", new Date(2026, 10, 4))).toBe("2–8 ноября 2026");
  });
});
