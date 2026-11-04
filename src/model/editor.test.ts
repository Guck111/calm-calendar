import { describe, expect, it } from "vitest";
import { applyChange, validate } from "./editor";
import type { EventDraft } from "../shared/api/types";

const base: EventDraft = {
  calendarId: "primary",
  title: "",
  allDay: false,
  startDate: "2026-11-04",
  startTime: "09:00",
  endDate: "2026-11-04",
  endTime: "10:30",
  location: "",
  description: "",
  recurring: false,
};

describe("форма события", () => {
  it("при сдвиге начала конец сдвигается с той же длительностью", () => {
    const next = applyChange(base, { startTime: "23:00" });
    expect([next.endDate, next.endTime]).toEqual(["2026-11-05", "00:30"]);
  });

  it("смена названия не трогает время", () => {
    expect(applyChange(base, { title: "x" }).endTime).toBe("10:30");
  });

  it("для события на весь день сохраняется число дней", () => {
    const multi = { ...base, allDay: true, endDate: "2026-11-06" };
    expect(applyChange(multi, { startDate: "2026-11-10" }).endDate).toBe("2026-11-12");
  });

  it("конец раньше начала — ошибка, однодневное событие на весь день — нет", () => {
    expect(validate({ ...base, endTime: "08:00" })).not.toBeNull();
    expect(validate({ ...base, allDay: true, endDate: "2026-11-04" })).toBeNull();
    expect(validate({ ...base, calendarId: "" })).not.toBeNull();
  });
});
