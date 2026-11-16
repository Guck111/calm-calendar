import { allSettled, fork } from "effector";
import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "../shared/api/types";
import { $isCurrentMonth, $month, $monthEvents, $upcoming, fetchMonthFx, fetchUpcomingFx, monthReset, monthShifted } from "./model";
import { addMonths, startOfMonth } from "../shared/lib/date";

describe("months in the widget", () => {
  it("arrows page the month, reset returns to the current one", async () => {
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

const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((ok) => (resolve = ok));
  return { promise, resolve };
};

const event = (title: string) => ({ key: title, id: title, calendarId: "work", title }) as unknown as CalendarEvent;

describe("late responses in the widget", () => {
  it("the nearest events of an older refresh do not replace a newer list", async () => {
    const older = deferred<CalendarEvent[]>();
    const scope = fork({
      handlers: [[fetchUpcomingFx, ({ today }: { today: Date }) => (today.getDate() === 1 ? older.promise : [event("new")])]],
    });
    const first = allSettled(fetchUpcomingFx, { scope, params: { calendars: [], today: new Date(2026, 10, 1) } });
    const second = allSettled(fetchUpcomingFx, { scope, params: { calendars: [], today: new Date(2026, 10, 2) } });
    older.resolve([event("old")]);
    await Promise.all([first, second]);
    expect(scope.getState($upcoming).map((e) => e.title)).toEqual(["new"]);
  });

  it("dots of an older load of the same month do not replace the newer ones", async () => {
    const month = startOfMonth(new Date());
    const older = deferred<{ month: Date; events: CalendarEvent[] }>();
    let call = 0;
    const scope = fork({
      handlers: [[fetchMonthFx, () => (++call === 1 ? older.promise : { month, events: [event("new")] })]],
    });
    const first = allSettled(fetchMonthFx, { scope, params: { calendars: [], month } });
    const second = allSettled(fetchMonthFx, { scope, params: { calendars: [], month } });
    older.resolve({ month, events: [event("old")] });
    await Promise.all([first, second]);
    expect(scope.getState($monthEvents).map((e) => e.title)).toEqual(["new"]);
  });
});
