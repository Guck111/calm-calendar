import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Calendar, EventDraft } from "./types";

const googleRequest = vi.fn();
vi.mock("./bridge", () => ({
  googleRequest: (...args: unknown[]) => googleRequest(...args),
  isAppError: (e: unknown) => typeof e === "object" && e !== null && "kind" in e,
}));

const { calendarRef, calendarVisible, listAllCalendars, saveEvent, splitRef, toCalendarEvent } = await import(
  "./calendar"
);

beforeEach(() => googleRequest.mockReset());

const ME = "me@gmail.com";
const WORK = "work@company.com";

const draft = (over: Partial<EventDraft>): EventDraft => ({
  calendarId: calendarRef(ME, "primary"),
  title: "Встреча",
  allDay: false,
  startDate: "2026-11-04",
  startTime: "09:00",
  endDate: "2026-11-04",
  endTime: "10:00",
  location: "",
  description: "",
  recurrence: [],
  ...over,
});

describe("несколько аккаунтов", () => {
  it("один и тот же календарь Google в двух аккаунтах — разные календари приложения", () => {
    const holidays = "ru.russian#holiday@group.v.calendar.google.com";
    expect(calendarRef(ME, holidays)).not.toBe(calendarRef(WORK, holidays));
    expect(splitRef(calendarRef(WORK, holidays))).toEqual({ account: WORK, googleId: holidays });
  });

  it("событие знает свой аккаунт, ключ различает аккаунты", () => {
    const raw = { id: "e1", start: { dateTime: "2026-11-04T09:00:00Z" }, iCalUID: "x@google.com" };
    const mine = toCalendarEvent(calendarRef(ME, "primary"), raw);
    const work = toCalendarEvent(calendarRef(WORK, "primary"), raw);
    expect(mine).toMatchObject({ account: ME, iCalUID: "x@google.com", free: false });
    expect(mine?.key).not.toBe(work?.key);
  });

  it("запрос уходит от аккаунта календаря и с id календаря в Google", async () => {
    googleRequest.mockResolvedValue({});
    await saveEvent(draft({ calendarId: calendarRef(WORK, "team@company.com") }));
    expect(googleRequest).toHaveBeenCalledWith(
      WORK,
      "POST",
      "/calendar/v3/calendars/team%40company.com/events",
      undefined,
      expect.objectContaining({ summary: "Встреча" }),
    );
  });

  it("перенос между календарями одного аккаунта — через move, между аккаунтами — ошибка без запросов", async () => {
    googleRequest.mockResolvedValue({});
    await saveEvent(draft({ id: "e1", originalCalendarId: calendarRef(ME, "primary"), calendarId: calendarRef(ME, "sport") }));
    expect(googleRequest.mock.calls[0]).toEqual([ME, "POST", "/calendar/v3/calendars/primary/events/e1/move", { destination: "sport" }, undefined]);

    googleRequest.mockClear();
    await expect(
      saveEvent(draft({ id: "e1", originalCalendarId: calendarRef(ME, "primary"), calendarId: calendarRef(WORK, "primary") })),
    ).rejects.toMatchObject({ kind: "other" });
    expect(googleRequest).not.toHaveBeenCalled();
  });

  it("если не ответил один аккаунт, календари остальных всё равно приходят", async () => {
    googleRequest.mockImplementation((account: string) =>
      account === WORK
        ? Promise.reject({ kind: "not_signed_in", message: "" })
        : Promise.resolve({ items: [{ id: "primary", summary: "Личное", accessRole: "owner", primary: true }] }),
    );
    const result = await listAllCalendars([ME, WORK]);
    expect(result.calendars.map((c) => [c.account, c.googleId])).toEqual([[ME, "primary"]]);
    expect(result).toMatchObject({ failed: [WORK], lost: [WORK] });
  });

  it("включённость календаря из версии с одним аккаунтом сохраняется", () => {
    const c = { id: calendarRef(ME, "sport"), googleId: "sport", selected: true } as Calendar;
    expect(calendarVisible(c, { sport: false })).toBe(false);
    expect(calendarVisible(c, { sport: false, [c.id]: true })).toBe(true);
  });
});
