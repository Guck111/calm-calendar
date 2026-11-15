// «Отменить» после переноса и удаления: удаление уходит в Google не сразу, а когда строка «Отменить» исчезла
import { allSettled, fork } from "effector";
import { describe, expect, it } from "vitest";
import type { CalendarEvent, EventDraft, Scope } from "../shared/api/types";
import { toCalendarEvent } from "../shared/api/calendar";
import { deleteClicked, deleteFx, eventMoved, eventOpened, moveFx, scopeChosen } from "./editor";
import { $events, fetchEventsFx } from "./events";
import { $undo, undoClicked, undoDismissed, undoExpired, undoPaused, undoResumed, undoTimerFx } from "./undo";

const make = (id: string, summary: string, start: string, end: string, extra: object = {}) =>
  toCalendarEvent("me@example.com\u0000primary", {
    id,
    summary,
    start: { dateTime: start },
    end: { dateTime: end },
    organizer: { email: "me@example.com", self: true },
    ...extra,
  }) as CalendarEvent;

const dentist = make("e1", "Dentist", "2026-11-11T16:00:00+01:00", "2026-11-11T16:45:00+01:00");
const lunch = make("e2", "Lunch", "2026-11-12T13:00:00+01:00", "2026-11-12T14:00:00+01:00");
const yoga = (day: number) =>
  make(`y_2026111${day}`, "Yoga", `2026-11-1${day}T07:00:00+01:00`, `2026-11-1${day}T08:00:00+01:00`, {
    recurringEventId: "y",
    originalStartTime: { dateTime: `2026-11-1${day}T07:00:00+01:00` },
  });

type Deleted = { draft: EventDraft; scope: Scope };

const setup = (events: CalendarEvent[] = [dentist, lunch]) => {
  const deleted: Deleted[] = [];
  const moved: { start: Date; end: Date }[] = [];
  const timers: number[] = [];
  const scope = fork({
    values: [[$events, events]],
    handlers: [
      [deleteFx, (c: Deleted) => void deleted.push(c)],
      [moveFx, ({ start, end }: { start: Date; end: Date }) => void moved.push({ start, end })],
      // таймер не срабатывает сам: тест решает, когда «Отменить» исчезает
      [undoTimerFx, ({ ms }: { ms: number }) => (timers.push(ms), -1)],
    ],
  });
  const titles = () => scope.getState($events).map((e) => e.title);
  const expire = () => allSettled(undoExpired, { scope, params: scope.getState($undo)?.id ?? -1 });
  return { scope, deleted, moved, timers, titles, expire };
};

const remove = async (scope: ReturnType<typeof fork>, e: CalendarEvent) => {
  await allSettled(eventOpened, { scope, params: e });
  await allSettled(deleteClicked, { scope });
};

describe("отмена удаления", () => {
  it("событие сразу пропадает с экрана, а в Google удаляется, когда «Отменить» исчезла", async () => {
    const { scope, deleted, timers, titles, expire } = setup();
    await remove(scope, dentist);
    expect(titles()).toEqual(["Lunch"]);
    expect(scope.getState($undo)).toMatchObject({ kind: "deleted", title: "Dentist" });
    expect(timers).toEqual([8000]);
    expect(deleted).toEqual([]);

    await expire();
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatchObject({ draft: { id: "e1" }, scope: "this" });
    expect(scope.getState($undo)).toBeNull();
  });

  it("«Отменить» возвращает событие, и в Google ничего не уходит", async () => {
    const { scope, deleted, titles, expire } = setup();
    await remove(scope, dentist);
    const id = scope.getState($undo)?.id;
    await allSettled(undoClicked, { scope });
    expect(titles()).toEqual(["Lunch", "Dentist"]);
    expect(scope.getState($undo)).toBeNull();
    // таймер старой строки сработал позже — ничего не удаляет
    await allSettled(undoExpired, { scope, params: id ?? -1 });
    await expire();
    expect(deleted).toEqual([]);
  });

  it("пока мышь на строке, она не исчезает; потом ещё 4 секунды", async () => {
    const { scope, deleted, timers, expire } = setup();
    await remove(scope, dentist);
    const first = scope.getState($undo)?.id ?? -1;
    await allSettled(undoPaused, { scope });
    await allSettled(undoExpired, { scope, params: first });
    expect(deleted).toEqual([]);
    expect(scope.getState($undo)).not.toBeNull();
    await allSettled(undoResumed, { scope });
    expect(timers).toEqual([8000, 4000]);
    await expire();
    expect(deleted).toHaveLength(1);
  });

  it("× закрывает строку и сразу отправляет удаление", async () => {
    const { scope, deleted } = setup();
    await remove(scope, dentist);
    await allSettled(undoDismissed, { scope });
    expect(deleted).toHaveLength(1);
    expect(scope.getState($undo)).toBeNull();
  });

  it("следующее удаление сразу отправляет предыдущее", async () => {
    const { scope, deleted, titles } = setup();
    await remove(scope, dentist);
    await remove(scope, lunch);
    expect(deleted.map((d) => d.draft.id)).toEqual(["e1"]);
    expect(titles()).toEqual([]);
    expect(scope.getState($undo)).toMatchObject({ title: "Lunch" });
  });

  it("обновление из Google, пока «Отменить» видна, не возвращает событие на экран", async () => {
    // загрузку подменяем ответом Google, где событие ещё есть
    const reloaded = fork({
      values: [[$events, [dentist, lunch]]],
      handlers: [
        [fetchEventsFx, async () => ({ events: [dentist, lunch], failed: [], lost: false, id: 0 })],
        [deleteFx, () => undefined],
        [undoTimerFx, () => -1],
      ],
    });
    await remove(reloaded, dentist);
    await allSettled(fetchEventsFx, {
      scope: reloaded,
      params: { calendars: [], range: { start: new Date(2026, 10, 9), end: new Date(2026, 10, 16) }, id: 0 },
    });
    expect(reloaded.getState($events).map((e) => e.title)).toEqual(["Lunch"]);
  });

  it("«это и следующие» у серии прячет повторения с этого дня, «это» — одно", async () => {
    const { scope, titles, deleted, expire } = setup([yoga(1), yoga(2), yoga(3), lunch]);
    await allSettled(eventOpened, { scope, params: yoga(2) });
    await allSettled(deleteClicked, { scope });
    await allSettled(scopeChosen, { scope, params: "following" });
    expect(titles()).toEqual(["Yoga", "Lunch"]);
    await expire();
    expect(deleted[0]).toMatchObject({ draft: { id: "y_20261112" }, scope: "following" });

    const single = setup([yoga(1), yoga(2), yoga(3)]);
    await allSettled(eventOpened, { scope: single.scope, params: yoga(2) });
    await allSettled(deleteClicked, { scope: single.scope });
    await allSettled(scopeChosen, { scope: single.scope, params: "this" });
    expect(single.scope.getState($events).map((e) => e.id)).toEqual(["y_20261111", "y_20261113"]);
  });
});

describe("отмена переноса", () => {
  it("«Отменить» возвращает прежнее время и не предлагает отменить саму отмену", async () => {
    const { scope, moved } = setup();
    const start = new Date(2026, 10, 13, 10, 0);
    const end = new Date(2026, 10, 13, 10, 45);
    await allSettled(eventMoved, { scope, params: { event: dentist, start, end } });
    expect(scope.getState($undo)).toMatchObject({ kind: "moved", title: "Dentist" });
    expect(scope.getState($events).find((e) => e.id === "e1")?.start).toEqual(start);

    await allSettled(undoClicked, { scope });
    expect(moved).toEqual([
      { start, end },
      { start: dentist.start, end: dentist.end },
    ]);
    expect(scope.getState($events).find((e) => e.id === "e1")?.start).toEqual(dentist.start);
    expect(scope.getState($undo)).toBeNull();
  });

  it("перенос не удался — отменять нечего", async () => {
    const scope = fork({
      values: [[$events, [dentist]]],
      handlers: [
        [moveFx, () => Promise.reject({ kind: "network", message: "нет сети" })],
        [undoTimerFx, () => -1],
      ],
    });
    await allSettled(eventMoved, { scope, params: { event: dentist, start: new Date(2026, 10, 13, 10), end: new Date(2026, 10, 13, 11) } });
    expect(scope.getState($undo)).toBeNull();
  });
});
