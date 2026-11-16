// «Отменить» после переноса и удаления: удаление уходит в Google не сразу, а когда строка «Отменить» исчезла
import { allSettled, createWatch, fork, scopeBind } from "effector";
import { describe, expect, it } from "vitest";
import type { AppError, CalendarEvent, EventDraft, Scope } from "../shared/api/types";

type Change = { draft: EventDraft; scope: Scope };
import { toCalendarEvent } from "../shared/api/calendar";
import { deleteClicked, deleteFx, eventMoved, eventOpened, moveFx, scopeChosen } from "./editor";
import { $events, fetchEventsFx, reloadRequested } from "./events";
import { $visibility } from "./calendars";
import { fetchStatusFx, signOutClicked, signOutFx } from "./auth";
import { $deleteJournal, $leftoverDeletes, $undo, persistDeleteFx, restoreMoveFx, undoClicked, undoDismissed, undoExpired, undoPaused, undoResumed, undoTimerFx } from "./undo";

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

/** удалить сразу, не дожидаясь запросов, которые уже идут */
const removeNow = (scope: ReturnType<typeof fork>, e: CalendarEvent) => {
  scopeBind(eventOpened, { scope })(e);
  scopeBind(deleteClicked, { scope })();
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

  // журнал удалений на диске: удаление стирается из него, только когда Google ответил
  const journal = (saved: unknown[]) => (saved.at(-1) as Change[] | undefined)?.map((c) => c.draft.id) ?? [];

  it("удаление в журнале, пока Google не ответил; отмена его стирает", async () => {
    const saved: unknown[] = [];
    let answer = () => {};
    const scope = fork({
      values: [[$events, [dentist, lunch]]],
      handlers: [
        [deleteFx, () => new Promise<void>((r) => (answer = r))],
        [persistDeleteFx, (c: unknown) => void saved.push(c)],
        [undoTimerFx, () => -1],
      ],
    });
    await remove(scope, dentist);
    expect(journal(saved)).toEqual(["e1"]);
    await allSettled(undoClicked, { scope });
    expect(journal(saved)).toEqual([]);

    await remove(scope, lunch);
    const sending = allSettled(undoDismissed, { scope });
    await Promise.resolve();
    // запрос ещё идёт: закрой приложение сейчас — удаление уйдёт при следующем входе
    expect(journal(saved)).toEqual(["e2"]);
    answer();
    await sending;
    expect(journal(saved)).toEqual([]);
  });

  it("ответ на старое удаление не стирает из журнала новое", async () => {
    const saved: unknown[] = [];
    const answers: (() => void)[] = [];
    const scope = fork({
      values: [[$events, [dentist, lunch]]],
      handlers: [
        [deleteFx, () => new Promise<void>((r) => answers.push(r))],
        [persistDeleteFx, (c: unknown) => void saved.push(c)],
        [undoTimerFx, () => -1],
      ],
    });
    await remove(scope, dentist);
    const first = allSettled(undoDismissed, { scope });
    // пока первое удаление идёт, удаляем второе (без ожидания: allSettled ждал бы и первый запрос)
    removeNow(scope, lunch);
    answers[0]();
    await first;
    expect(journal(saved)).toEqual(["e2"]);
  });

  it("сбой сети оставляет удаление в журнале, отказ Google (событие уже удалено) — убирает", async () => {
    const saved: unknown[] = [];
    let error: AppError = { kind: "network", message: "нет сети" };
    const scope = fork({
      values: [[$events, [dentist, lunch]]],
      handlers: [
        [deleteFx, () => Promise.reject(error)],
        [persistDeleteFx, (c: unknown) => void saved.push(c)],
        [undoTimerFx, () => -1],
      ],
    });
    await remove(scope, dentist);
    await allSettled(undoDismissed, { scope });
    expect(journal(saved)).toEqual(["e1"]);
    error = { kind: "google", message: "410: Resource has been deleted", status: 410 };
    await remove(scope, lunch);
    await allSettled(undoDismissed, { scope });
    expect(journal(saved)).toEqual(["e1"]);
  });

  it("после перезапуска удаление досылается, когда вошли именно в его аккаунт", async () => {
    const deleted: Deleted[] = [];
    let fail: AppError | null = { kind: "not_signed_in", message: "" };
    const leftover: Change = {
      draft: { id: "e1", originalCalendarId: "me@example.com\u0000primary" } as EventDraft,
      scope: "this",
    };
    let accounts = [{ email: "work@example.com", signedIn: true }];
    const scope = fork({
      values: [
        [$leftoverDeletes, [leftover]],
        [$deleteJournal, [leftover]],
      ],
      handlers: [
        [deleteFx, (c: Deleted) => (deleted.push(c), fail ? Promise.reject(fail) : undefined)],
        [persistDeleteFx, () => undefined],
        [fetchStatusFx, () => ({ clientSource: "file", accounts })],
      ],
    });
    // вошли только в рабочий аккаунт: ждём
    await allSettled(fetchStatusFx, { scope });
    expect(deleted).toHaveLength(0);
    // вошли в свой, но вход ещё не действует: удаление не пропадает
    accounts = [...accounts, { email: "me@example.com", signedIn: true }];
    await allSettled(fetchStatusFx, { scope });
    expect(deleted).toHaveLength(1);
    expect(scope.getState($deleteJournal)).toHaveLength(1);
    // вход снова потерян и восстановлен — пробуем ещё раз, теперь удачно
    fail = null;
    accounts = [{ email: "work@example.com", signedIn: true }];
    await allSettled(fetchStatusFx, { scope });
    accounts = [...accounts, { email: "me@example.com", signedIn: true }];
    await allSettled(fetchStatusFx, { scope });
    expect(deleted).toHaveLength(2);
    expect(scope.getState($deleteJournal)).toEqual([]);
  });
});

describe("перенос и удаление вперемешку", () => {
  it("медленный перенос не затирает более новое удаление", async () => {
    let saved = () => {};
    const deleted: Deleted[] = [];
    const scope = fork({
      values: [[$events, [dentist, lunch]]],
      handlers: [
        [moveFx, () => new Promise<void>((r) => (saved = r))],
        [deleteFx, (c: Deleted) => void deleted.push(c)],
        [persistDeleteFx, () => undefined],
        [undoTimerFx, () => -1],
      ],
    });
    const moving = allSettled(eventMoved, {
      scope,
      params: { event: dentist, start: new Date(2026, 10, 13, 10), end: new Date(2026, 10, 13, 11) },
    });
    removeNow(scope, lunch);
    saved();
    await moving;
    expect(scope.getState($undo)).toMatchObject({ kind: "deleted", title: "Lunch" });
    await allSettled(undoExpired, { scope, params: scope.getState($undo)?.id ?? -1 });
    expect(deleted.map((d) => d.draft.id)).toEqual(["e2"]);
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

describe("журнал удалений: каждое удаление само по себе", () => {
  // приглашение на встречу: копии в календарях двух аккаунтов с одним и тем же id события
  const copyIn = (calendarId: string) =>
    toCalendarEvent(calendarId, {
      id: "m1",
      summary: "Sync",
      start: { dateTime: "2026-11-12T10:00:00+01:00" },
      end: { dateTime: "2026-11-12T11:00:00+01:00" },
    }) as CalendarEvent;
  const mine = copyIn("me@example.com\u0000primary");
  const work = copyIn("work@example.com\u0000primary");

  it("ответ на удаление одной копии не трогает удаление другой", async () => {
    const answers: (() => void)[] = [];
    const scope = fork({
      values: [[$events, [mine, work]]],
      handlers: [
        [deleteFx, () => new Promise<void>((r) => answers.push(r))],
        [persistDeleteFx, () => undefined],
        [undoTimerFx, () => -1],
        [fetchEventsFx, async () => ({ events: [mine, work], failed: [], lost: false, id: 0 })],
      ],
    });
    removeNow(scope, mine);
    const first = allSettled(undoDismissed, { scope });
    removeNow(scope, work);
    answers[0]();
    await first;
    expect(scope.getState($deleteJournal).map((c) => c.draft.originalCalendarId)).toEqual([work.calendarId]);
    // вторая копия всё ещё спрятана: её удаление ждёт своего ответа
    scopeBind(fetchEventsFx, { scope })({ calendars: [], range: { start: new Date(2026, 10, 9), end: new Date(2026, 10, 16) }, id: 0 });
    await Promise.resolve();
    await Promise.resolve();
    expect(scope.getState($events).map((e) => e.calendarId)).not.toContain(work.calendarId);
    answers[1]?.();
  });

  it("неудачная попытка не удалит событие, если его потом удалили снова и отменили", async () => {
    const deleted: Deleted[] = [];
    let fail: AppError | null = { kind: "network", message: "нет сети" };
    let accounts = [{ email: "me@example.com", signedIn: true }];
    const scope = fork({
      values: [[$events, [dentist, lunch]]],
      handlers: [
        [deleteFx, (c: Deleted) => (deleted.push(c), fail ? Promise.reject(fail) : undefined)],
        [persistDeleteFx, () => undefined],
        [undoTimerFx, () => -1],
        [fetchStatusFx, () => ({ clientSource: "file", accounts })],
      ],
    });
    await remove(scope, dentist);
    await allSettled(undoDismissed, { scope });
    expect(scope.getState($leftoverDeletes)).toHaveLength(1);
    // событие вернулось на экран (удаление не дошло), его удалили снова и передумали
    await allSettled($events, { scope, params: [dentist, lunch] });
    await remove(scope, dentist);
    await allSettled(undoClicked, { scope });
    expect(scope.getState($leftoverDeletes)).toEqual([]);
    // сеть вернулась, вход заработал — повторять нечего
    fail = null;
    accounts = [{ email: "work@example.com", signedIn: true }];
    await allSettled(fetchStatusFx, { scope });
    accounts = [{ email: "me@example.com", signedIn: true }];
    await allSettled(fetchStatusFx, { scope });
    expect(deleted).toHaveLength(1);
  });
});
