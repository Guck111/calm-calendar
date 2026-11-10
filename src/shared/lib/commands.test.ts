// Меню команд (Ctrl+K): что предложить по введённому тексту. Тесты на русском — язык по умолчанию в тестах
import { describe, expect, it } from "vitest";
import { buildCommands, commandLabel } from "./commands";
import { t } from "../i18n";

const now = new Date(2026, 10, 11, 9, 50);
const kinds = (text: string) => buildCommands(text, now).map((c) => (c.kind === "view" ? `view:${c.view}` : c.kind));

describe("меню команд", () => {
  it("пустая строка: создать, сегодня и четыре вида", () => {
    expect(kinds("")).toEqual(["new", "today", "view:day", "view:week", "view:month", "view:agenda"]);
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
