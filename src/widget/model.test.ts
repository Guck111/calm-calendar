import { allSettled, fork } from "effector";
import { describe, expect, it } from "vitest";
import { $isCurrentMonth, $month, monthReset, monthShifted } from "./model";
import { addMonths, startOfMonth } from "../shared/lib/date";

describe("месяцы в виджете", () => {
  it("стрелки листают месяц, сброс возвращает к текущему", async () => {
    const scope = fork();
    const current = startOfMonth(new Date());
    await allSettled(monthShifted, { scope, params: 1 });
    await allSettled(monthShifted, { scope, params: 1 });
    expect(scope.getState($month)).toEqual(addMonths(current, 2));
    expect(scope.getState($isCurrentMonth)).toBe(false);
    await allSettled(monthReset, { scope });
    expect(scope.getState($month)).toEqual(current);
    expect(scope.getState($isCurrentMonth)).toBe(true);
  });
});
