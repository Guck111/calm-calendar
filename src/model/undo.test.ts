// «Отменить» после переноса и удаления: удаление уходит в Google не сразу, а когда строка «Отменить» исчезла
import { allSettled, createWatch, fork } from "effector";
import { describe, expect, it } from "vitest";
import type { CalendarEvent, EventDraft, Scope } from "../shared/api/types";
import { toCalendarEvent } from "../shared/api/calendar";
import { deleteClicked, deleteFx, eventMoved, eventOpened, moveFx, scopeChosen } from "./editor";
import { $events, fetchEventsFx, reloadRequested } from "./events";
import { $visibility } from "./calendars";
import { fetchStatusFx, signOutClicked, signOutFx } from "./auth";
import { $leftoverDelete, $undo, persistDeleteFx, restoreMoveFx, undoClicked, undoDismissed, undoExpired, undoPaused, undoResumed, undoTimerFx } from "./undo";

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
  const restored: { event: CalendarEvent; start: Date; end: Date }[] = [];
  const timers: number[] = [];
  const scope = fork({
    values: [[$events, events]],
    handlers: [
      [deleteFx, (c: Deleted) => void deleted.push(c)],
      [moveFx, ({ start, end }: { start: Date; end: Date }) => void moved.push({ start, end })],
      [restoreMoveFx, (r: { event: CalendarEvent; start: Date; end: Date }) => void restored.push(r)],
      // таймер не срабатывает сам: тест решает, когда «Отменить» исчезает
      [undoTimerFx, ({ ms }: { ms: number }) => (timers.push(ms), -1)],
      [persistDeleteFx, () => undefined],
    ],
  });
  const titles = () => scope.getState($events).map((e) => e.title);
  const expire = () => allSettled(undoExpired, { scope, params: scope.getState($undo)?.id ?? -1 });
  return { scope, deleted, moved, restored, timers, titles, expire };
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
  const start = new Date(2026, 10, 13, 10, 0);
  const end = new Date(2026, 10, 13, 10, 45);

  it("«Отменить» возвращает прежнее время и не предлагает отменить саму отмену", async () => {
    const { scope, moved, restored } = setup();
    await allSettled(eventMoved, { scope, params: { event: dentist, start, end } });
    expect(scope.getState($undo)).toMatchObject({ kind: "moved", title: "Dentist" });
    expect(scope.getState($events).find((e) => e.id === "e1")?.start).toEqual(start);

    await allSettled(undoClicked, { scope });
    expect(moved).toEqual([{ start, end }]);
    expect(restored.map((r) => ({ start: r.start, end: r.end }))).toEqual([{ start: dentist.start, end: dentist.end }]);
    expect(scope.getState($events).find((e) => e.id === "e1")?.start).toEqual(dentist.start);
    expect(scope.getState($undo)).toBeNull();
  });

  it("отмена меняет только время: правка, сделанная после переноса, остаётся", async () => {
    const { scope, restored } = setup();
    await allSettled(eventMoved, { scope, params: { event: dentist, start, end } });
    // пока строка видна, событию поменяли цвет (Ctrl+K)
    const recolored = scope.getState($events).map((e) => (e.id === "e1" ? { ...e, colorId: "11" } : e));
    await allSettled($events, { scope, params: recolored });
    await allSettled(undoClicked, { scope });
    expect(restored[0].event).toMatchObject({ colorId: "11" });
    expect(restored[0]).toMatchObject({ start: dentist.start, end: dentist.end });
  });

  it("строка появляется, только когда Google подтвердил перенос: отмена не обгоняет его", async () => {
    let done = () => {};
    const scope = fork({
      values: [[$events, [dentist]]],
      handlers: [
        [moveFx, () => new Promise<void>((r) => (done = r))],
        [undoTimerFx, () => -1],
      ],
    });
    const moving = allSettled(eventMoved, { scope, params: { event: dentist, start, end } });
    await Promise.resolve();
    expect(scope.getState($undo)).toBeNull();
    done();
    await moving;
    expect(scope.getState($undo)).toMatchObject({ kind: "moved" });
  });

  it("перенос сразу отправляет ожидающее удаление", async () => {
    const { scope, deleted } = setup();
    await remove(scope, lunch);
    await allSettled(eventMoved, { scope, params: { event: dentist, start, end } });
    expect(deleted.map((d) => d.draft.id)).toEqual(["e2"]);
    expect(scope.getState($undo)).toMatchObject({ kind: "moved" });
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

describe("удаление не теряется", () => {
  it("выход из аккаунта ждёт, пока ожидающее удаление дойдёт до Google", async () => {
    const order: string[] = [];
    const scope = fork({
      values: [[$events, [dentist, lunch]]],
      handlers: [
        [deleteFx, async () => void order.push("delete")],
        [signOutFx, async (account: string) => void order.push(`sign out ${account}`)],
        [persistDeleteFx, () => undefined],
        [undoTimerFx, () => -1],
      ],
    });
    await remove(scope, dentist);
    await allSettled(signOutClicked, { scope, params: "work@example.com" });
    expect(order).toEqual(["delete", "sign out work@example.com"]);
    expect(scope.getState($undo)).toBeNull();
  });

  it("без ожидающего удаления выход идёт сразу", async () => {
    const order: string[] = [];
    const scope = fork({
      handlers: [[signOutFx, async () => void order.push("sign out")]],
    });
    await allSettled(signOutClicked, { scope, params: "work@example.com" });
    expect(order).toEqual(["sign out"]);
  });

  it("ожидающее удаление записано на диск, пока видна строка; отмена и отправка его стирают", async () => {
    const saved: unknown[] = [];
    const scope = fork({
      values: [[$events, [dentist, lunch]]],
      handlers: [
        [deleteFx, () => undefined],
        [persistDeleteFx, (c: unknown) => void saved.push(c)],
        [undoTimerFx, () => -1],
      ],
    });
    await remove(scope, dentist);
    expect(saved).toMatchObject([{ draft: { id: "e1" }, scope: "this" }]);
    await allSettled(undoClicked, { scope });
    expect(saved.at(-1)).toBeNull();
    await remove(scope, lunch);
    await allSettled(undoDismissed, { scope });
    expect(saved.at(-1)).toBeNull();
  });

  it("приложение закрыли, пока видна строка: при следующем входе удаление досылается", async () => {
    const deleted: Deleted[] = [];
    const saved: unknown[] = [];
    const leftover = { draft: { id: "e1" } as EventDraft, scope: "this" as Scope };
    const scope = fork({
      values: [[$leftoverDelete, leftover]],
      handlers: [
        [deleteFx, (c: Deleted) => void deleted.push(c)],
        [persistDeleteFx, (c: unknown) => void saved.push(c)],
        [fetchStatusFx, () => ({ clientSource: "file", accounts: [{ email: "me@example.com", signedIn: true }] })],
      ],
    });
    await allSettled(fetchStatusFx, { scope });
    expect(deleted).toMatchObject([{ draft: { id: "e1" } }]);
    expect(saved.at(-1)).toBeNull();
    // второй раз не шлём
    await allSettled(fetchStatusFx, { scope });
    expect(deleted).toHaveLength(1);
  });
});

describe("удаление серии и отмена: точнее", () => {
  // повторение серии, перенесённое с одного дня на другой: originalStart — его день по правилу
  const moved = (origDay: number, day: number) =>
    make(`y_2026111${origDay}`, "Yoga", `2026-11-1${day}T07:00:00+01:00`, `2026-11-1${day}T08:00:00+01:00`, {
      recurringEventId: "y",
      originalStartTime: { dateTime: `2026-11-1${origDay}T07:00:00+01:00` },
    });

  it("«это и следующие» считает от дня повторения по правилу, а не от перенесённого времени", async () => {
    // повторение 11-го перенесено на 14-е, повторение 14-го — на 10-е; удаляем с 12-го
    const { scope } = setup([moved(1, 4), yoga(2), yoga(3), moved(4, 0)]);
    await allSettled(eventOpened, { scope, params: yoga(2) });
    await allSettled(deleteClicked, { scope });
    await allSettled(scopeChosen, { scope, params: "following" });
    expect(scope.getState($events).map((e) => e.id)).toEqual(["y_20261111"]);
  });

  it("«Отменить» не возвращает события календаря, который за это время скрыли, и перечитывает список", async () => {
    const { scope } = setup();
    const reloads: number[] = [];
    createWatch({ unit: reloadRequested, scope, fn: () => void reloads.push(1) });
    await remove(scope, dentist);
    await allSettled($visibility, { scope, params: { [dentist.calendarId]: false } });
    await allSettled(undoClicked, { scope });
    expect(scope.getState($events).map((e) => e.title)).toEqual(["Lunch"]);
    expect(reloads.length).toBeGreaterThan(0);
  });
});
