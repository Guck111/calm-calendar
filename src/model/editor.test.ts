import { allSettled, fork } from "effector";
import { describe, expect, it } from "vitest";
import type { CalendarEvent, EventDraft } from "../shared/api/types";
import {
  $askScope,
  $draft,
  $mode,
  $recurrenceEdited,
  applyChange,
  deleteClicked,
  deleteFx,
  draftChanged,
  editCancelled,
  editClicked,
  eventOpened,
  loadSeriesFx,
  saveClicked,
  saveFx,
  scopeCancelled,
  scopeChosen,
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
  recurrence: [],
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
  calendarId: "c", account: "",
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

const occurrence: CalendarEvent = {
  ...event,
  key: "c\u0000w_20261111",
  id: "w_20261111",
  title: "Работа",
  start: new Date(2026, 10, 11, 12),
  end: new Date(2026, 10, 11, 18),
  recurring: true,
  recurringEventId: "w",
  originalStart: { dateTime: new Date(2026, 10, 11, 12).toISOString() },
};

const WEEKDAYS = ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"];

describe("правило повтора в форме", () => {
  it("у нового события правило следует за датой начала", () => {
    const weekly = { ...base, recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"] };
    expect(applyChange(weekly, { startDate: "2026-11-05" }).recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=TH"]);
  });

  it("у повторения серии перенос даты правило не меняет", () => {
    const one = { ...base, recurringEventId: "w", recurrence: WEEKDAYS, originalRecurrence: WEEKDAYS };
    expect(applyChange(one, { startDate: "2026-11-05" }).recurrence).toEqual(WEEKDAYS);
  });
});

describe("повторение серии", () => {
  const opened = async () => {
    const calls: { save: unknown[]; del: unknown[] } = { save: [], del: [] };
    const scope = fork({
      handlers: [
        [loadSeriesFx, async () => WEEKDAYS],
        [saveFx, async (p: unknown) => void calls.save.push(p)],
        [deleteFx, async (p: unknown) => void calls.del.push(p)],
      ],
    });
    await allSettled(eventOpened, { scope, params: occurrence });
    return { scope, calls };
  };

  it("правило серии подгружается в черновик", async () => {
    const { scope } = await opened();
    expect(scope.getState($draft)).toMatchObject({ recurrence: WEEKDAYS, originalRecurrence: WEEKDAYS });
  });

  it("перед сохранением спрашивает, к каким повторениям применить", async () => {
    const { scope, calls } = await opened();
    await allSettled(editClicked, { scope });
    await allSettled(draftChanged, { scope, params: { startTime: "13:00" } });
    await allSettled(saveClicked, { scope });
    expect(scope.getState($askScope)).toBe("save");
    expect(calls.save).toHaveLength(0);

    await allSettled(scopeChosen, { scope, params: "following" });
    expect(calls.save).toMatchObject([{ scope: "following", draft: { startTime: "13:00", recurringEventId: "w" } }]);
    expect(scope.getState($askScope)).toBeNull();
  });

  it("удаление тоже спрашивает; «Отмена» ничего не удаляет", async () => {
    const { scope, calls } = await opened();
    await allSettled(deleteClicked, { scope });
    expect(scope.getState($askScope)).toBe("delete");
    await allSettled(scopeCancelled, { scope });
    expect(calls.del).toHaveLength(0);
    await allSettled(deleteClicked, { scope });
    await allSettled(scopeChosen, { scope, params: "this" });
    expect(calls.del).toMatchObject([{ scope: "this", draft: { id: "w_20261111" } }]);
  });

  it("изменённое правило замечается", async () => {
    const { scope } = await opened();
    await allSettled(editClicked, { scope });
    expect(scope.getState($recurrenceEdited)).toBe(false);
    await allSettled(draftChanged, { scope, params: { recurrence: ["RRULE:FREQ=DAILY"] } });
    expect(scope.getState($recurrenceEdited)).toBe(true);
  });

  it("обычное событие сохраняется без вопроса", async () => {
    const { scope, calls } = await opened();
    await allSettled(eventOpened, { scope, params: event });
    await allSettled(editClicked, { scope });
    await allSettled(saveClicked, { scope });
    expect(scope.getState($askScope)).toBeNull();
    expect(calls.save).toMatchObject([{ scope: "this", draft: { id: "e1" } }]);
  });
});
