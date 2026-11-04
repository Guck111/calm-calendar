import { allSettled, fork } from "effector";
import { describe, expect, it } from "vitest";
import type { CalendarEvent, EventDraft } from "../shared/api/types";
import {
  $draft,
  $mode,
  applyChange,
  draftChanged,
  editCancelled,
  editClicked,
  eventOpened,
  validate,
} from "./editor";

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

const event: CalendarEvent = {
  key: "c\u0000e1",
  id: "e1",
  calendarId: "c",
  title: "Польский",
  start: new Date(2026, 10, 7, 14, 30),
  end: new Date(2026, 10, 7, 16, 30),
  allDay: false,
  recurring: false,
};

describe("просмотр и правка события", () => {
  it("клик по событию открывает просмотр, «Редактировать» — форму", async () => {
    const scope = fork();
    await allSettled(eventOpened, { scope, params: event });
    expect(scope.getState($mode)).toBe("view");
    await allSettled(editClicked, { scope });
    expect(scope.getState($mode)).toBe("edit");
  });

  it("«Отмена» возвращает к просмотру и отбрасывает несохранённые правки", async () => {
    const scope = fork();
    await allSettled(eventOpened, { scope, params: event });
    await allSettled(editClicked, { scope });
    await allSettled(draftChanged, { scope, params: { title: "Другое" } });
    await allSettled(editCancelled, { scope });
    expect(scope.getState($mode)).toBe("view");
    expect(scope.getState($draft)?.title).toBe("Польский");
  });
});
