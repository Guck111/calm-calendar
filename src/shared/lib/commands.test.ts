// Command menu (Ctrl+K): what to offer for the typed text. Tests are in Russian — the default language in tests
import { describe, expect, it } from "vitest";
import { buildCommands, commandLabel } from "./commands";
import { t } from "../i18n";

const now = new Date(2026, 10, 11, 9, 50);
const kinds = (text: string) => buildCommands(text, now).map((c) => (c.kind === "view" ? `view:${c.view}` : c.kind));

describe("command menu", () => {
  it("empty input: create, today, four views, keyboard shortcuts and 'What it can do'", () => {
    expect(kinds("")).toEqual(["new", "today", "view:day", "view:week", "view:month", "view:agenda", "shortcuts", "welcome"]);
    expect(commandLabel({ kind: "welcome" })).toBe(t.welcome.command);
  });

  it("a date in words — first the jump to it", () => {
    const [first] = buildCommands("завтра", now);
    expect(first).toEqual({ kind: "date", date: new Date(2026, 10, 12) });
    expect(buildCommands("20 ноября", now)[0]).toEqual({ kind: "date", date: new Date(2026, 10, 20) });
    expect(buildCommands("пт", now)[0]).toEqual({ kind: "date", date: new Date(2026, 10, 13) });
  });

  it("plain text: create an event and search", () => {
    expect(kinds("стоматолог")).toEqual(["create", "search"]);
    expect(buildCommands("стоматолог", now)[0]).toEqual({ kind: "create", text: "стоматолог" });
  });

  it("part of a command name finds it, including together with 'create' and 'search'", () => {
    expect(kinds("меся")).toEqual(["create", "search", "view:month"]);
    expect(kinds("СЕГОД")).toContain("today");
  });

  it("a quick add phrase with a date — both jump and create", () => {
    expect(kinds("пт 13:00 обед с Олей")).toEqual(["create", "search"]);
    expect(kinds("пт")).toEqual(["date", "create", "search"]);
  });

  it("command labels are in the UI language", () => {
    expect(commandLabel({ kind: "view", view: "month" })).toBe(t.toolbar.views.month);
    expect(commandLabel({ kind: "search", text: "йога" })).toBe(t.commands.search("йога"));
    expect(commandLabel({ kind: "create", text: "йога" })).toBe(t.commands.create("йога"));
    expect(commandLabel({ kind: "date", date: new Date(2026, 10, 12) })).toMatch(/^Перейти/);
  });
});

describe("command menu: selected event", () => {
  const timed = { title: "Стоматолог", allDay: false, hasMeet: false };
  const eventKinds = (text: string, subject = timed) =>
    buildCommands(text, now, subject).map((c) => (c.kind === "view" ? `view:${c.view}` : c.kind === "color" ? `color:${c.colorId}` : c.kind));

  it("empty input: first actions on the event, then regular commands", () => {
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
      "welcome",
    ]);
  });

  it("all-day — without 'an hour later'; with a video meeting — without 'add Meet'", () => {
    expect(eventKinds("", { ...timed, allDay: true })).not.toContain("later");
    expect(eventKinds("", { ...timed, hasMeet: true })).not.toContain("meet");
  });

  it("colors are found by name, 'calendar color' too", () => {
    expect(eventKinds("томат")).toContain("color:11");
    expect(eventKinds("цвет")).toEqual(expect.arrayContaining(["color:", "color:1", "color:11"]));
    // no colors without a selected event
    expect(kinds("томат")).not.toContain("color");
  });

  it("action labels", () => {
    expect(commandLabel({ kind: "tomorrow" })).toBe(t.commands.moveTomorrow);
    expect(commandLabel({ kind: "later" })).toBe(t.commands.hourLater);
    expect(commandLabel({ kind: "meet" })).toBe(t.editor.addMeet);
    expect(commandLabel({ kind: "color", colorId: "11" })).toBe(t.commands.color("Томат"));
    expect(commandLabel({ kind: "color", colorId: "" })).toBe(t.commands.color(t.editor.calendarColor));
  });
});

describe("command menu: theme and free time", () => {
  it("found by name, but don't clutter the empty input", () => {
    expect(kinds("")).not.toContain("theme");
    expect(kinds("")).not.toContain("free");
    const dark = buildCommands(t.settings.themes.dark, now);
    expect(dark).toContainEqual({ kind: "theme", theme: "dark" });
    expect(commandLabel({ kind: "theme", theme: "dark" })).toBe(`${t.settings.theme}: ${t.settings.themes.dark}`);
    expect(buildCommands(t.free.title.slice(0, 5), now)).toContainEqual({ kind: "free" });
    expect(commandLabel({ kind: "free" })).toBe(t.free.title);
  });
});
