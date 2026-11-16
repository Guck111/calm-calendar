import { allSettled, fork } from "effector";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { applyChange, draftOpened, saveClicked, saveFx } from "../model/editor";
import { draftToBody } from "../shared/api/calendar";
import type { CalendarEvent, EventDraft } from "../shared/api/types";
import { addDays, localTimeZone, startOfDay, startOfMonth } from "../shared/lib/date";
import { shiftEvent } from "../shared/lib/drag";
import { freeSlots } from "../shared/lib/free";
import { expandIcs, parseIcs } from "../shared/lib/ics";
import { eventsForDay, layoutDay } from "../shared/lib/layout";
import { parseQuick, quickToDraft } from "../shared/lib/quick";
import { $month, $status, fetchCalendarsFx, fetchMonthFx, minuteTicked, monthShifted } from "../widget/model";

const WARSAW = "Europe/Warsaw";
const NEW_YORK = "America/New_York";
const eastern = localTimeZone() === NEW_YORK;
const springDay = eastern ? 8 : 29;
const fallMonth = eastern ? 10 : 9;
const fallDay = eastern ? 1 : 25;
const atSpring = (h = 0, m = 0) => new Date(2026, 2, springDay, h, m);
const springDate = eastern ? "2026-03-08" : "2026-03-29";
const afterSpringDate = eastern ? "2026-03-09" : "2026-03-30";

const draft: EventDraft = {
  calendarId: "primary",
  title: "Meeting",
  allDay: false,
  startDate: "2026-11-04",
  startTime: "02:30",
  endDate: "2026-11-04",
  endTime: "03:00",
  location: "",
  description: "",
  recurrence: [],
};

const event = (start: Date, end: Date): CalendarEvent => ({
  key: "meeting",
  id: "meeting",
  calendarId: "primary",
  account: "",
  title: "Meeting",
  start,
  end,
  allDay: false,
  recurring: false,
});

describe("calendar DST regressions", () => {
  beforeAll(() => {
    if (!eastern && localTimeZone() !== WARSAW) vi.stubEnv("TZ", WARSAW);
  });
  afterAll(() => vi.unstubAllEnvs());

  it("1. validates the same instants the editor sends to Google", async () => {
    const dateDraft = (date: string, timeZone: string) => ({ ...draft, startDate: date, endDate: date, timeZone });
    const attempted = async (input: EventDraft) => {
      const save = vi.fn(({ draft }: { draft: EventDraft }) => draftToBody(draft));
      const scope = fork({ handlers: [[saveFx, save]] });
      await allSettled(draftOpened, { scope, params: input });
      await allSettled(saveClicked, { scope });
      return save.mock.results.map(({ value }) => [value.start.dateTime, value.end.dateTime]);
    };

    const otherSpringDate = eastern ? "2026-03-29" : "2026-03-08";
    expect.soft(await attempted(dateDraft(otherSpringDate, eastern ? WARSAW : NEW_YORK))).toEqual([]);
    expect.soft(await attempted(dateDraft(springDate, "UTC"))).toEqual([
      [springDate + "T02:30:00.000Z", springDate + "T03:00:00.000Z"],
    ]);
  });

  it("2. keeps both days when moving an all-day event from the spring transition", () => {
    const moved = applyChange(
      { ...draft, allDay: true, startDate: springDate, endDate: afterSpringDate },
      { startDate: "2026-04-01" },
    );
    expect(draftToBody(moved)).toMatchObject({
      start: { date: "2026-04-01" },
      end: { date: "2026-04-03" },
    });
  });

  it("3. places events at their wall-clock rows on short and long days", () => {
    const day = new Date(2026, fallMonth, fallDay);
    const fallStart = new Date(2026, fallMonth, fallDay, 23, 30);
    expect.soft(layoutDay([event(atSpring(9), atSpring(10))], atSpring()))
      .toMatchObject([{ startMin: 540, endMin: 600 }]);
    expect.soft(layoutDay([event(fallStart, addDays(day, 1))], day))
      .toMatchObject([{ startMin: 1410, endMin: 1440 }]);
  });

  it("4. preserves duration when a move puts the start in the spring gap", () => {
    const original = event(addDays(atSpring(), -1), addDays(atSpring(), -1));
    original.start.setHours(2, 30);
    original.end.setHours(3, 30);
    expect(shiftEvent(original, "move", 0, 1)).toEqual({
      start: atSpring(3, 30),
      end: atSpring(4, 30),
    });
  });

  it("5. uses the stated local working hours on the spring transition", () => {
    const day = atSpring();
    expect(freeSlots([], [day], { from: 540, to: 1080, minLength: 30, weekends: true }, day))
      .toEqual([{ day, slots: [{ start: atSpring(9), end: atSpring(18) }] }]);
  });

  it("6. displays an instantaneous ICS event only on the day that starts at its midnight", () => {
    const day = new Date(2026, 10, 4);
    const previous = addDays(day, -1);
    const cal = parseIcs([
      "BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:midnight", "DTSTART:20261104T000000",
      "SUMMARY:Midnight", "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n"));
    const read = (start: Date, end: Date) => expandIcs(cal, { start, end }, "feed", "", "Untitled");
    const events = read(day, addDays(day, 1));

    expect.soft(read(previous, day)).toEqual([]);
    expect.soft(events).toMatchObject([{ start: day, end: day }]);
    expect.soft(eventsForDay(events, previous)).toEqual([]);
    expect.soft(eventsForDay(events, day)).toEqual(events);
    expect.soft(layoutDay(events, day)).toMatchObject([{ startMin: 0, endMin: 20 }]);
    expect.soft(eventsForDay([event(addDays(day, -1), day)], day)).toEqual([]);
  });

  it("7. keeps the selected month and avoids reloading until the date changes", async () => {
    const statuses = { clientSource: "build" as const, accounts: [{ email: "user@example.com", signedIn: true }] };
    const loadCalendars = vi.fn(async () => []);
    const loadMonth = vi.fn(async ({ month }: { month: Date }) => ({ month, events: [] }));
    const scope = fork({
      values: [[$status, statuses]],
      handlers: [[fetchCalendarsFx, loadCalendars], [fetchMonthFx, loadMonth]],
    });
    const today = startOfDay(new Date());
    const tick = (date: Date) => allSettled(minuteTicked, { scope, params: date });

    const morning = new Date(today);
    morning.setHours(8);
    await tick(morning);
    await allSettled(monthShifted, { scope, params: 1 });
    const selected = scope.getState($month);
    loadCalendars.mockClear();
    loadMonth.mockClear();

    const later = new Date(morning);
    later.setMinutes(1);
    await tick(later);
    expect.soft(scope.getState($month)).toEqual(selected);
    expect.soft(loadCalendars).not.toHaveBeenCalled();
    expect.soft(loadMonth).not.toHaveBeenCalled();

    loadCalendars.mockClear();
    loadMonth.mockClear();
    const tomorrow = addDays(today, 1);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(tomorrow);
    try {
      await tick(tomorrow);
      expect.soft(scope.getState($month)).toEqual(startOfMonth(tomorrow));
      expect.soft(loadCalendars).toHaveBeenCalledTimes(1);
      expect.soft(loadMonth).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("8. chooses the next leap day and rejects an impossible explicit date", () => {
    const now = new Date(2026, 10, 4, 12);
    const parse = (text: string) => parseQuick(text, now, [], "ru");

    expect.soft(parse("Встреча 29 февраля").start).toEqual(new Date(2028, 1, 29));
    expect.soft(parse("Встреча 29 февраля 2024").start).toEqual(new Date(2024, 1, 29));
    expect.soft(quickToDraft(parse("Встреча 29 февраля 2025"), "primary"))
      .toMatchObject({ title: "Встреча", startDate: "", endDate: "" });
  });

  it("9. keeps a spring-gap range on the same day and preserves its intended length", () => {
    const parse = (range: string) =>
      parseQuick("Встреча " + springDay + " марта 2026 " + range, new Date(2026, 2, 1), [], "ru");
    expect.soft(parse("02:30–03:00")).toMatchObject({ start: atSpring(3, 30), end: atSpring(4) });
    expect.soft(parse("23:00–01:00")).toMatchObject({
      start: atSpring(23),
      end: addDays(atSpring(1), 1),
    });
  });
});
