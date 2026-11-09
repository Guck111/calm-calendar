import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "../api/types";
import { findConflicts } from "./conflicts";

const ev = (key: string, account: string, from: number, to: number, over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  key,
  id: key,
  calendarId: `${account}\u0000primary`,
  account,
  title: key,
  start: new Date(2026, 10, 9, from),
  end: new Date(2026, 10, 9, to),
  allDay: false,
  recurring: false,
  ...over,
});

const keys = (m: Map<string, CalendarEvent[]>) =>
  Object.fromEntries([...m].map(([k, list]) => [k, list.map((e) => e.key)]));

describe("пересечения между аккаунтами", () => {
  it("находит встречу по работе в то же время, что личная", () => {
    const found = findConflicts([ev("gym", "me", 9, 11), ev("standup", "work", 10, 12), ev("lunch", "me", 13, 14)]);
    expect(keys(found)).toEqual({ gym: ["standup"], standup: ["gym"] });
  });

  it("события одного аккаунта и соседние по времени — не пересечение", () => {
    expect(findConflicts([ev("a", "me", 9, 10), ev("b", "me", 9, 10), ev("c", "work", 10, 11)]).size).toBe(0);
  });

  it("одна встреча в двух аккаунтах, весь день и «свободен» не считаются", () => {
    const found = findConflicts([
      ev("invite-me", "me", 9, 10, { iCalUID: "x@google.com" }),
      ev("invite-work", "work", 9, 10, { iCalUID: "x@google.com" }),
      ev("holiday", "work", 0, 23, { allDay: true }),
      ev("focus", "work", 9, 10, { free: true }),
    ]);
    expect(found.size).toBe(0);
  });

  it("длинное событие пересекается с несколькими", () => {
    const found = findConflicts([ev("trip", "me", 8, 18), ev("a", "work", 9, 10), ev("b", "work", 15, 16)]);
    expect(keys(found).trip).toEqual(["a", "b"]);
  });
});
