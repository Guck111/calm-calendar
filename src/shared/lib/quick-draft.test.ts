import { describe, expect, it } from "vitest";
import { parseQuick, quickToDraft, quickWhen } from "./quick";

// Wednesday, November 4, 2026, 18:00
const now = new Date(2026, 10, 4, 18, 0);
const quick = (input: string) => parseQuick(input, now, [], "ru");

describe("quick add: impossible clock times", () => {
  it("a time the clock doesn't have makes the date invalid, the last minute of an hour is fine", () => {
    expect(quick("завтра 9:75 встреча").start.getTime()).toBeNaN();
    expect(quick("завтра 9:59 встреча").start).toEqual(new Date(2026, 10, 5, 9, 59));
  });

  it("a calendar tag without calendars to match is just dropped", () => {
    expect(parseQuick("завтра обед #работа", now).calendarId).toBeUndefined();
  });
});

describe("quick add: form draft", () => {
  it("a timed event with its own calendar and place", () => {
    const r = { ...quick("завтра 19:00 ужин @Гдыня"), calendarId: "work" };
    expect(quickToDraft(r, "me")).toEqual({
      calendarId: "work",
      title: "Ужин",
      allDay: false,
      startDate: "2026-11-05",
      startTime: "19:00",
      endDate: "2026-11-05",
      endTime: "20:00",
      location: "Гдыня",
      description: "",
      recurrence: [],
    });
  });

  it("an all-day event ends on its last day, without a calendar it goes to the default one", () => {
    expect(quickToDraft(quick("завтра отпуск"), "me")).toMatchObject({
      calendarId: "me", allDay: true, startDate: "2026-11-05", endDate: "2026-11-05", location: "",
    });
  });

  it("an invalid date leaves the date and time fields empty", () => {
    expect(quickToDraft(quick("завтра 25:30 встреча"), "me")).toMatchObject({
      startDate: "", startTime: "", endDate: "", endTime: "",
    });
  });
});

describe("quick add: hint under the input", () => {
  it("names the day, the time and whether it ends the next day", () => {
    expect(quickWhen(quick("завтра 19:00 ужин"))).toBe("Чт, 5 ноября · 19:00–20:00");
    expect(quickWhen(quick("завтра 23-1 вечеринка"))).toBe("Чт, 5 ноября · 23:00–01:00 (на следующий день)");
    expect(quickWhen(quick("завтра отпуск"))).toBe("Чт, 5 ноября · весь день");
    expect(quickWhen(quick("завтра 25:30 встреча"))).toBe("Проверь дату и время");
  });
});
