import { afterEach, describe, expect, it } from "vitest";
import type { CalendarEvent } from "../api/types";
import { setLang } from "../i18n";
import { freeSlots, isWeekend, type FreeOptions } from "./free";

afterEach(() => setLang("ru"));

const monday = new Date(2026, 10, 9);
const early = new Date(2026, 10, 9, 7);
const at = (h: number, m = 0) => new Date(2026, 10, 9, h, m);
const event = (key: string, start: Date, end: Date): CalendarEvent => ({
  key, id: key, calendarId: "me\u0000primary", account: "me", title: key, start, end, allDay: false, recurring: false,
});
const hours = (events: CalendarEvent[], o: FreeOptions) =>
  freeSlots(events, [monday], o, early).flatMap((d) => d.slots.map((s) => `${s.start.getHours()}:${s.start.getMinutes()}-${s.end.getHours()}:${s.end.getMinutes()}`));
const workday: FreeOptions = { from: 9 * 60, to: 18 * 60, minLength: 30, weekends: false };

describe("free time gaps", () => {
  it("events listed out of order give the same gaps", () => {
    expect(hours([event("late", at(14), at(15)), event("early", at(10), at(11))], workday))
      .toEqual(["9:0-10:0", "11:0-14:0", "15:0-18:0"]);
  });

  it("gaps shorter than the minimum are dropped, one exactly as long stays", () => {
    const o = { ...workday, minLength: 60 };
    expect(hours([event("a", at(10), at(16, 15)), event("b", at(16, 30), at(17))], o)).toEqual(["9:0-10:0", "17:0-18:0"]);
  });

  it("no empty gaps at the edges of the day, even without a minimum length", () => {
    const o = { ...workday, minLength: 0 };
    expect(hours([event("a", at(9), at(10)), event("b", at(17), at(18))], o)).toEqual(["10:0-17:0"]);
  });
});

describe("weekend of the region", () => {
  const friday = new Date(2026, 10, 6);
  const sunday = new Date(2026, 10, 8);

  it("Saturday and Sunday in Britain, Friday and Saturday in Saudi Arabia", () => {
    setLang("en", "en-GB");
    expect([isWeekend(friday), isWeekend(sunday)]).toEqual([false, true]);
    setLang("ar", "ar-SA");
    expect([isWeekend(friday), isWeekend(sunday)]).toEqual([true, false]);
  });
});
