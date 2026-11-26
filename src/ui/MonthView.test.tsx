// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { allSettled, type Scope } from "effector";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { $weekNumbers } from "../model/display";
import { $draft, $opened } from "../model/editor";
import { $cursor, $now, $today, $view, dateSelected } from "../model/view";
import type { CalendarEvent } from "../shared/api/types";
import { setLang } from "../shared/i18n";
import { formatTime } from "../shared/lib/date";
import { appScope, event, renderIn } from "./app-scope.test-utils";
import { MonthView } from "./MonthView";

beforeEach(() => setLang("en"));
afterEach(() => {
  cleanup();
  setLang("ru");
});

// November 2026; now is Wednesday the 11th, 12:00. In English the week starts on Sunday
const NOW = new Date(2026, 10, 11, 12, 0);

const show = async (events: CalendarEvent[] = [], weekNumbers = false) => {
  const scope: Scope = await appScope({
    events,
    values: [
      [$now, NOW],
      [$today, new Date(2026, 10, 11)],
      [$weekNumbers, weekNumbers],
    ],
  });
  await allSettled(dateSelected, { scope, params: new Date(2026, 10, 11) });
  const view = renderIn(scope, <MonthView />);
  return { scope, view };
};

const cell = (n: number, month = "") =>
  screen.getAllByRole("button", { name: month ? `${n} ${month}` : String(n) }).map((b) => b.parentElement as HTMLElement);
const dayCell = (n: number) => cell(n).find((c) => !c.className.includes("outside")) as HTMLElement;
const timed = (day: number, i: number, over: Partial<CalendarEvent> = {}) =>
  event({ key: `t${day}-${i}`, id: `t${day}-${i}`, title: `Meeting ${i}`, start: new Date(2026, 10, day, 9 + i), end: new Date(2026, 10, day, 10 + i), ...over });

describe("month view", () => {
  it("six weeks, the weekday names, days of other months set apart", async () => {
    const { view } = await show();
    const grid = view.container.querySelector("[class*=grid]") as HTMLElement;
    expect(grid.children).toHaveLength(42);
    expect(view.container.querySelector("[class*=weekdays]")?.children).toHaveLength(7);
    // November 2026 starts on Sunday, the grid ends on Saturday, December 12
    expect(grid.children[0].textContent).toBe("1 Nov");
    expect(grid.children[0].className).not.toContain("outside");
    expect(grid.children[41].textContent).toBe("12");
    expect(grid.children[41].className).toContain("outside");
  });

  it("the first day of a month names the month; today is marked", async () => {
    await show();
    expect(cell(1, "Nov")).toHaveLength(1);
    expect(cell(1, "Dec")).toHaveLength(1);
    const today = within(dayCell(11)).getByRole("button", { name: "11" });
    expect(today.className).toContain("today");
    expect(within(dayCell(12)).getByRole("button", { name: "12" }).className).not.toContain("today");
    expect(today.title).toBe("Open day");
  });

  it("a day number opens the day", async () => {
    const { scope } = await show();
    fireEvent.click(within(dayCell(18)).getByRole("button", { name: "18" }));
    expect(scope.getState($view)).toBe("day");
    expect(scope.getState($cursor)).toEqual(new Date(2026, 10, 18));
  });

  it("a click on an empty spot of a day creates an event at 9:00 that day", async () => {
    const { scope } = await show();
    fireEvent.click(dayCell(20));
    expect(scope.getState($draft)).toMatchObject({ startDate: "2026-11-20", startTime: "09:00" });
  });

  it("a click on a day number or an event doesn't create one", async () => {
    const { scope } = await show([timed(20, 0)]);
    fireEvent.click(within(dayCell(20)).getByRole("button", { name: /Meeting 0/ }));
    expect(scope.getState($opened)?.key).toBe("t20-0");
    expect(scope.getState($draft)?.id).toBe("t20-0");
    fireEvent.click(within(dayCell(20)).getByRole("button", { name: "20" }));
    expect(scope.getState($draft)?.id).toBe("t20-0");
  });

  it("a timed event shows its time and a dot, an all-day one is a plain block", async () => {
    const allDay = event({ key: "a", id: "a", title: "Holiday", allDay: true, start: new Date(2026, 10, 18), end: new Date(2026, 10, 19) });
    await show([timed(18, 0), allDay]);
    const meeting = screen.getByRole("button", { name: /Meeting 0/ });
    expect(meeting.textContent).toBe(`${formatTime(new Date(2026, 10, 18, 9))}Meeting 0`);
    expect(meeting.title).toBe("Meeting 0");
    expect(meeting.querySelector("[class*=dot]")).not.toBeNull();
    expect(meeting.className).not.toContain("block");
    const holiday = screen.getByRole("button", { name: "Holiday" });
    expect(holiday.textContent).toBe("Holiday");
    expect(holiday.className).toContain("block");
    expect(holiday.getAttribute("data-event-key")).toBe("a");
  });

  it("an event over several days continues from the second day, and starts again on a new week row", async () => {
    // Saturday the 14th to Tuesday the 17th
    const trip = event({ key: "trip", id: "trip", title: "Trip", allDay: true, start: new Date(2026, 10, 14), end: new Date(2026, 10, 18) });
    await show([trip]);
    const chip = (day: number) => within(dayCell(day)).getByRole("button", { name: "Trip" }).className;
    expect(chip(14)).not.toContain("continues");
    // Sunday the 15th starts an English week row
    expect(chip(15)).not.toContain("continues");
    expect(chip(16)).toContain("continues");
    expect(chip(17)).toContain("continues");
    cleanup();
    // a Russian week row starts on Monday the 16th
    setLang("ru");
    await show([trip]);
    expect(chip(15)).toContain("continues");
    expect(chip(16)).not.toContain("continues");
  });

  it("events that ended are dimmed", async () => {
    await show([timed(11, 0), timed(11, 5)]);
    expect(screen.getByRole("button", { name: /Meeting 0/ }).className).toContain("past");
    expect(screen.getByRole("button", { name: /Meeting 5/ }).className).not.toContain("past");
  });

  it("up to four events fit; with more, three and 'N more' that opens the day", async () => {
    const { scope } = await show([...[0, 1, 2, 3].map((i) => timed(18, i)), ...[0, 1, 2, 3, 4].map((i) => timed(19, i))]);
    expect(within(dayCell(18)).getAllByRole("button", { name: /Meeting/ })).toHaveLength(4);
    expect(within(dayCell(18)).queryByRole("button", { name: /more/ })).toBeNull();
    expect(within(dayCell(19)).getAllByRole("button", { name: /Meeting/ })).toHaveLength(3);
    fireEvent.click(within(dayCell(19)).getByRole("button", { name: "2 more" }));
    expect(scope.getState($view)).toBe("day");
    expect(scope.getState($cursor)).toEqual(new Date(2026, 10, 19));
  });

  it("week numbers on the first day of each row, when turned on", async () => {
    const { view } = await show([], true);
    const numbers = [...view.container.querySelectorAll("[class*=weekNo]")];
    expect(numbers.map((n) => n.textContent)).toEqual(["45", "46", "47", "48", "49", "50"]);
    expect((numbers[0] as HTMLElement).title).toBe("Week 45");
    cleanup();
    const off = await show();
    expect(off.view.container.querySelector("[class*=weekNo]")).toBeNull();
  });
});
