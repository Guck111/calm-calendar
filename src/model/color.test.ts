// Цвет отдельного события (colorId Google): чтение, форма, сохранение, цвет на экране
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Calendar, CalendarEvent } from "../shared/api/types";

const googleRequest = vi.fn();
vi.mock(import("../shared/api/bridge"), async (importOriginal) => ({
  ...(await importOriginal()),
  googleRequest: (...args: unknown[]) => googleRequest(...args),
}));

const { draftToBody, saveEvent, toCalendarEvent } = await import("../shared/api/calendar");
const { applyChange, fromEvent } = await import("./editor");
const { EVENT_COLORS, eventColor } = await import("../shared/lib/colors");

beforeEach(() => {
  googleRequest.mockReset();
  googleRequest.mockResolvedValue({});
});

const CAL = "me@example.com\u0000primary";
const calendar = { id: CAL, color: "#4f8ef7" } as Calendar;

const event = (over: Record<string, unknown> = {}): CalendarEvent =>
  toCalendarEvent(CAL, {
    id: "e1",
    summary: "Йога",
    start: { dateTime: "2026-11-11T18:00:00Z" },
    end: { dateTime: "2026-11-11T19:00:00Z" },
    ...over,
  }) as CalendarEvent;

const call = (method: string) => googleRequest.mock.calls.find((c) => c[1] === method);

describe("цвет события", () => {
  it("11 цветов Google, как в его веб-версии", () => {
    expect(Object.keys(EVENT_COLORS)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]);
    expect(EVENT_COLORS["11"]).toBe("#d50000");
  });

  it("читается из Google; неизвестный id не считается", () => {
    expect(event({ colorId: "4" }).colorId).toBe("4");
    expect(event({ colorId: "99" }).colorId).toBeUndefined();
    expect(event().colorId).toBeUndefined();
  });

  it("на экране — цвет события, без него — цвет календаря", () => {
    expect(eventColor(event({ colorId: "2" }), calendar)).toBe(EVENT_COLORS["2"]);
    expect(eventColor(event(), calendar)).toBe("#4f8ef7");
    expect(eventColor(event(), undefined)).toBe("#8ab4f8");
  });

  it("в форме: свой цвет или пустая строка — цвет календаря", () => {
    expect(fromEvent(event({ colorId: "6" })).colorId).toBe("6");
    expect(fromEvent(event()).colorId).toBe("");
  });

  it("сохраняется в colorId; «цвет календаря» сбрасывает его", async () => {
    expect(draftToBody(applyChange(fromEvent(event()), { colorId: "5" }))).toHaveProperty("colorId", "5");
    await saveEvent(applyChange(fromEvent(event({ colorId: "5" })), { colorId: "" }));
    expect(call("PATCH")?.[4]).toHaveProperty("colorId", null);
  });

  it("новое событие без цвета не шлёт colorId", async () => {
    const { id: _, ...draft } = fromEvent(event());
    await saveEvent(draft);
    expect(call("POST")?.[4]).not.toHaveProperty("colorId");
  });
});
