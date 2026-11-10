// Меню команд (Ctrl+K): что предложить по введённому тексту. Тесты на русском — язык по умолчанию в тестах
import { describe, expect, it } from "vitest";
import { buildCommands, commandLabel } from "./commands";
import { t } from "../i18n";

const now = new Date(2026, 10, 11, 9, 50);
const kinds = (text: string) => buildCommands(text, now).map((c) => (c.kind === "view" ? `view:${c.view}` : c.kind));

describe("меню команд", () => {
  it("пустая строка: создать, сегодня, четыре вида и сочетания клавиш", () => {
    expect(kinds("")).toEqual(["new", "today", "view:day", "view:week", "view:month", "view:agenda", "shortcuts"]);
  });

  it("дата словами — сначала переход к ней", () => {
    const [first] = buildCommands("завтра", now);
    expect(first).toEqual({ kind: "date", date: new Date(2026, 10, 12) });
    expect(buildCommands("20 ноября", now)[0]).toEqual({ kind: "date", date: new Date(2026, 10, 20) });
    expect(buildCommands("пт", now)[0]).toEqual({ kind: "date", date: new Date(2026, 10, 13) });
  });

  it("обычный текст: создать событие и найти", () => {
    expect(kinds("стоматолог")).toEqual(["create", "search"]);
    expect(buildCommands("стоматолог", now)[0]).toEqual({ kind: "create", text: "стоматолог" });
  });

  it("часть названия команды находит её, в том числе вместе с «создать» и «найти»", () => {
    expect(kinds("меся")).toEqual(["create", "search", "view:month"]);
    expect(kinds("СЕГОД")).toContain("today");
  });

  it("фраза быстрого ввода с датой — и переход, и создание", () => {
    expect(kinds("пт 13:00 обед с Олей")).toEqual(["create", "search"]);
    expect(kinds("пт")).toEqual(["date", "create", "search"]);
  });

  it("подписи команд — на языке интерфейса", () => {
    expect(commandLabel({ kind: "view", view: "month" })).toBe(t.toolbar.views.month);
    expect(commandLabel({ kind: "search", text: "йога" })).toBe(t.commands.search("йога"));
    expect(commandLabel({ kind: "create", text: "йога" })).toBe(t.commands.create("йога"));
    expect(commandLabel({ kind: "date", date: new Date(2026, 10, 12) })).toMatch(/^Перейти/);
  });
});

describe("меню команд: выбранное событие", () => {
  const timed = { title: "Стоматолог", allDay: false, hasMeet: false };
  const eventKinds = (text: string, subject = timed) =>
    buildCommands(text, now, subject).map((c) => (c.kind === "view" ? `view:${c.view}` : c.kind === "color" ? `color:${c.colorId}` : c.kind));

  it("пустая строка: сначала действия с событием, потом обычные команды", () => {
    expect(eventKinds("")).toEqual([
      "tomorrow",
      "later",
      "meet",
      "new",
      "today",
      "view:day",
      "view:week",
      "view:month",
      "view:agenda",
      "shortcuts",
    ]);
  });

  it("на весь день — без «на час позже»; с видеовстречей — без «добавить Meet»", () => {
    expect(eventKinds("", { ...timed, allDay: true })).not.toContain("later");
    expect(eventKinds("", { ...timed, hasMeet: true })).not.toContain("meet");
  });

  it("цвета находятся по названию, «цвет календаря» — тоже", () => {
    expect(eventKinds("томат")).toContain("color:11");
    expect(eventKinds("цвет")).toEqual(expect.arrayContaining(["color:", "color:1", "color:11"]));
    // без выбранного события цветов нет
    expect(kinds("томат")).not.toContain("color");
  });

  it("подписи действий", () => {
    expect(commandLabel({ kind: "tomorrow" })).toBe(t.commands.moveTomorrow);
    expect(commandLabel({ kind: "later" })).toBe(t.commands.hourLater);
    expect(commandLabel({ kind: "meet" })).toBe(t.editor.addMeet);
    expect(commandLabel({ kind: "color", colorId: "11" })).toBe(t.commands.color("Томат"));
    expect(commandLabel({ kind: "color", colorId: "" })).toBe(t.commands.color(t.editor.calendarColor));
  });
});
