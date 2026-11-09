// Пояс события: читается из Google, сохраняется при правке, перетаскивании и правке серии
import { allSettled, fork } from "effector";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent, EventDraft } from "../shared/api/types";

const googleRequest = vi.fn();
vi.mock(import("../shared/api/bridge"), async (importOriginal) => ({
  ...(await importOriginal()),
  googleRequest: (...args: unknown[]) => googleRequest(...args),
}));

const { draftToBody, followingRecurrence, saveEvent, toCalendarEvent } = await import("../shared/api/calendar");
const { applyChange, fromEvent, moveFx } = await import("./editor");
const { buildRecurrence, parseRecurrence } = await import("../shared/lib/rrule");
const { localTimeZone } = await import("../shared/lib/date");

beforeEach(() => {
  googleRequest.mockReset();
  googleRequest.mockResolvedValue({});
});

const NY = "America/New_York";
const TOKYO = "Asia/Tokyo";

/** созвон в 9:00 по Нью-Йорку, 4 ноября 2026 (UTC−5) */
const nyCall = (): CalendarEvent =>
  toCalendarEvent("c", {
    id: "e1",
    summary: "Созвон",
    start: { dateTime: "2026-11-04T09:00:00-05:00", timeZone: NY },
    end: { dateTime: "2026-11-04T10:00:00-05:00", timeZone: NY },
  }) as CalendarEvent;

const patches = () =>
  googleRequest.mock.calls.filter((c) => c[1] === "PATCH").map((c) => c[4] as ReturnType<typeof draftToBody>);

describe("пояс события из Google", () => {
  it("берётся из start.timeZone, без него — пояс календаря; у событий на весь день его нет", () => {
    expect(nyCall().timeZone).toBe(NY);
    const plain = toCalendarEvent("c", { id: "2", start: { dateTime: "2026-11-04T09:00:00Z" } }, TOKYO);
    expect(plain?.timeZone).toBe(TOKYO);
    const allDay = toCalendarEvent("c", { id: "3", start: { date: "2026-11-04" } }, TOKYO);
    expect(allDay?.timeZone).toBeUndefined();
  });

  it("свой пояс конца запоминается, только если он другой", () => {
    expect(nyCall().endTimeZone).toBeUndefined();
    const flight = toCalendarEvent("c", {
      id: "f",
      start: { dateTime: "2026-11-04T09:00:00-05:00", timeZone: NY },
      end: { dateTime: "2026-11-05T13:00:00+09:00", timeZone: TOKYO },
    });
    expect(flight?.endTimeZone).toBe(TOKYO);
  });

  it("в форме время по часам пояса события", () => {
    const d = fromEvent(nyCall());
    expect([d.startDate, d.startTime, d.endTime, d.timeZone]).toEqual(["2026-11-04", "09:00", "10:00", NY]);
  });

  it("сохранение без правок не меняет ни момент, ни пояс", () => {
    const body = draftToBody(fromEvent(nyCall()));
    expect(body.start).toMatchObject({ dateTime: "2026-11-04T14:00:00.000Z", timeZone: NY });
    expect(body.end).toMatchObject({ dateTime: "2026-11-04T15:00:00.000Z", timeZone: NY });
  });

  it("правка времени в форме — по часам пояса события", () => {
    const d = applyChange(fromEvent(nyCall()), { startTime: "11:00" });
    expect(draftToBody(d).start).toMatchObject({ dateTime: "2026-11-04T16:00:00.000Z", timeZone: NY });
  });

  it("смена пояса оставляет часы в форме и меняет момент", () => {
    const d = applyChange(fromEvent(nyCall()), { timeZone: TOKYO });
    expect([d.startTime, d.endTime]).toEqual(["09:00", "10:00"]);
    expect(draftToBody(d).start).toMatchObject({ dateTime: "2026-11-04T00:00:00.000Z", timeZone: TOKYO });
  });

  it("пояс конца сохраняется, пока пояс в форме не меняли", () => {
    const flight = toCalendarEvent("c", {
      id: "f",
      start: { dateTime: "2026-11-04T09:00:00-05:00", timeZone: NY },
      end: { dateTime: "2026-11-05T13:00:00+09:00", timeZone: TOKYO },
    }) as CalendarEvent;
    const d = fromEvent(flight);
    expect(draftToBody(d).end).toMatchObject({ dateTime: "2026-11-05T04:00:00.000Z", timeZone: TOKYO });
    const changed = applyChange(d, { timeZone: "Europe/London" });
    expect(draftToBody(changed).end).toMatchObject({ timeZone: "Europe/London" });
  });

  it("новое событие — в поясе системы", () => {
    const d: EventDraft = {
      calendarId: "c",
      title: "",
      allDay: false,
      startDate: "2026-11-04",
      startTime: "09:00",
      endDate: "2026-11-04",
      endTime: "10:00",
      location: "",
      description: "",
      recurrence: [],
    };
    expect(draftToBody(d).start).toMatchObject({ timeZone: localTimeZone() });
  });

  it("перетаскивание сохраняет пояс события", async () => {
    const e = nyCall();
    const hour = 3_600_000;
    await allSettled(moveFx, {
      scope: fork(),
      params: { event: e, start: new Date(e.start.getTime() + hour), end: new Date(e.end.getTime() + hour) },
    });
    expect(patches()).toMatchObject([
      {
        start: { dateTime: "2026-11-04T15:00:00.000Z", timeZone: NY },
        end: { dateTime: "2026-11-04T16:00:00.000Z", timeZone: NY },
      },
    ]);
  });

  it("правка повторения «только это» сохраняет пояс", async () => {
    const e = toCalendarEvent("c", {
      id: "s_1",
      recurringEventId: "s",
      originalStartTime: { dateTime: "2026-11-04T09:00:00-05:00", timeZone: NY },
      start: { dateTime: "2026-11-04T09:00:00-05:00", timeZone: NY },
      end: { dateTime: "2026-11-04T10:00:00-05:00", timeZone: NY },
    }) as CalendarEvent;
    await saveEvent(applyChange(fromEvent(e, []), { title: "Новое" }), "this");
    expect(patches()[0].start).toMatchObject({ dateTime: "2026-11-04T14:00:00.000Z", timeZone: NY });
  });
});

describe("правило повтора в поясе события", () => {
  // по средам в 7:00 по Токио — в Европе и в UTC это ещё вторник
  const series = {
    id: "s",
    recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"],
    start: { dateTime: "2026-11-04T07:00:00+09:00", timeZone: TOKYO },
    end: { dateTime: "2026-11-04T08:00:00+09:00", timeZone: TOKYO },
  };

  it("«это и следующие» с переносом на четверг: день недели по часам события", () => {
    const occurrence = toCalendarEvent("c", {
      id: "s_2",
      recurringEventId: "s",
      originalStartTime: { dateTime: "2026-11-11T07:00:00+09:00", timeZone: TOKYO },
      start: { dateTime: "2026-11-11T07:00:00+09:00", timeZone: TOKYO },
      end: { dateTime: "2026-11-11T08:00:00+09:00", timeZone: TOKYO },
    }) as CalendarEvent;
    const d = applyChange(fromEvent(occurrence, series.recurrence), { startDate: "2026-11-12" });
    expect(followingRecurrence(d, series, 0)).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=TH"]);
  });

  it("UNTIL — конец дня по часам пояса события", () => {
    const rule = { freq: "DAILY" as const, interval: 1, days: [], end: { kind: "until" as const, date: "2026-11-20" } };
    const start = new Date(2026, 10, 4, 18);
    const lines = buildRecurrence(rule, [], start, false, "America/Los_Angeles");
    expect(lines).toEqual(["RRULE:FREQ=DAILY;UNTIL=20261121T075959Z"]);
    expect(parseRecurrence(lines, start, "America/Los_Angeles").rule?.end).toEqual({ kind: "until", date: "2026-11-20" });
  });
});
