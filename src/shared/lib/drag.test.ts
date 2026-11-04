import { describe, expect, it } from "vitest";
import { shiftEvent, snap } from "./drag";

const e = { start: new Date(2026, 10, 4, 9, 0), end: new Date(2026, 10, 4, 10, 0) };

describe("перетаскивание", () => {
  it("шаг 15 минут", () => {
    expect(snap(22)).toBe(15);
    expect(snap(23)).toBe(30);
    expect(snap(-8)).toBe(-15);
  });

  it("перенос на другой день и время сохраняет длительность", () => {
    expect(shiftEvent(e, "move", 90, 2)).toEqual({
      start: new Date(2026, 10, 6, 10, 30),
      end: new Date(2026, 10, 6, 11, 30),
    });
  });

  it("растягивание меняет только конец и не делает событие короче шага", () => {
    expect(shiftEvent(e, "resize", 45, 0).end).toEqual(new Date(2026, 10, 4, 10, 45));
    expect(shiftEvent(e, "resize", -120, 0)).toEqual({ start: e.start, end: new Date(2026, 10, 4, 9, 15) });
  });
});
