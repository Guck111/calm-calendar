// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { type Scope } from "effector";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { $opened } from "../model/editor";
import { $query, searchFocusRequested, searchFx } from "../model/search";
import { $cursor, $view } from "../model/view";
import type { CalendarEvent } from "../shared/api/types";
import { setLang } from "../shared/i18n";
import { formatShortDate, formatTime } from "../shared/lib/date";
import { appScope, event, renderIn } from "./app-scope.test-utils";
import { Search } from "./Search";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  setLang("en");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setLang("ru");
});

type Found = { results: CalendarEvent[]; failed?: string[] } | Error | "pending";

const dentist = event({ title: "Dentist", start: new Date(2026, 11, 3, 16), end: new Date(2026, 11, 3, 17) });
const trip = event({ key: "t", id: "t", title: "Trip to Gdynia", allDay: true, start: new Date(2026, 11, 20), end: new Date(2026, 11, 22) });

const show = async (answers: Found[] = [{ results: [dentist, trip] }]) => {
  const search = vi.fn(async ({ id }: { query: string; id: number }) => {
    const answer = answers.length > 1 ? answers.shift() : answers[0];
    if (answer === "pending") return new Promise(() => {});
    if (answer instanceof Error) throw { kind: "network", message: answer.message };
    return { id, results: answer?.results ?? [], failed: answer && "failed" in answer ? (answer.failed ?? []) : [] };
  });
  const scope: Scope = await appScope({ handlers: [[searchFx, search]] });
  renderIn(scope, <Search />);
  return { scope, search };
};

const box = () => screen.getByRole("textbox", { name: "Search events" }) as HTMLInputElement;
const type = async (text: string) => {
  fireEvent.change(box(), { target: { value: text } });
  await act(async () => void vi.advanceTimersByTime(350));
};

describe("search", () => {
  it("the field invites with its shortcut and doesn't spell-check", async () => {
    await show();
    expect(box().placeholder).toBe("Search (Ctrl+F)");
    expect(box().getAttribute("spellcheck")).toBe("false");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("searches after a pause in typing, once", async () => {
    const { search } = await show();
    fireEvent.change(box(), { target: { value: "den" } });
    act(() => void vi.advanceTimersByTime(349));
    fireEvent.change(box(), { target: { value: "dent" } });
    act(() => void vi.advanceTimersByTime(349));
    expect(search).not.toHaveBeenCalled();
    await act(async () => void vi.advanceTimersByTime(1));
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0][0].query).toBe("dent");
  });

  it("results show the date, the time of a timed event and the title", async () => {
    await show();
    await type("dentist");
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      `${formatShortDate(dentist.start)}, ${formatTime(dentist.start)}Dentist`,
      `${formatShortDate(trip.start)}Trip to Gdynia`,
    ]);
    expect(options[0].style.getPropertyValue("--c")).not.toBe("");
  });

  it("a result opens its day and its card, and the search closes", async () => {
    const { scope } = await show();
    await type("trip");
    box().focus();
    fireEvent.click(screen.getByRole("option", { name: /Trip/ }));
    expect(scope.getState($view)).toBe("day");
    expect(scope.getState($cursor)).toEqual(new Date(2026, 11, 20));
    expect(scope.getState($opened)?.key).toBe("t");
    expect(scope.getState($query)).toBe("");
    expect(document.activeElement).not.toBe(box());
  });

  it("Enter opens the first result; with none it does nothing", async () => {
    const { scope } = await show([{ results: [dentist] }, { results: [] }]);
    await type("dentist");
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(scope.getState($opened)?.title).toBe("Dentist");
    await type("zzz");
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(scope.getState($query)).toBe("zzz");
  });

  it("Esc clears and leaves the search; other keys don't", async () => {
    const { scope } = await show();
    await type("dentist");
    box().focus();
    fireEvent.keyDown(box(), { key: "a" });
    expect(scope.getState($query)).toBe("dentist");
    fireEvent.keyDown(box(), { key: "Escape" });
    expect(scope.getState($query)).toBe("");
    expect(document.activeElement).not.toBe(box());
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("nothing found says so; a new search of the same text says it is searching", async () => {
    await show([{ results: [] }, "pending"]);
    await type("zzz");
    expect(screen.getByRole("listbox").textContent).toBe("Nothing found");
    await type("zzz ");
    expect(screen.getByRole("listbox").textContent).toBe("Searching…");
  });

  it("a failed search says why instead of 'nothing found'", async () => {
    await show([new Error("No internet")]);
    await type("dentist");
    expect(screen.getByRole("alert").textContent).toBe("Couldn't search: No internet");
    expect(screen.queryByText("Nothing found")).toBeNull();
  });

  it("calendars that didn't answer are named above the results", async () => {
    await show([{ results: [dentist], failed: ["Work"] }]);
    await type("dentist");
    expect(screen.getByRole("alert").textContent).toBe("Some calendars didn't respond: Work");
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("blank text shows no results", async () => {
    await show();
    await type("dentist");
    fireEvent.change(box(), { target: { value: "   " } });
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("getting to the search", () => {
  it("Ctrl+F and / jump to it and select the text; the page doesn't search itself", async () => {
    await show();
    fireEvent.change(box(), { target: { value: "old" } });
    const select = vi.spyOn(box(), "select");
    expect(fireEvent.keyDown(document.body, { key: "f", code: "KeyF", ctrlKey: true })).toBe(false);
    expect(document.activeElement).toBe(box());
    expect(select).toHaveBeenCalledTimes(1);
    box().blur();
    expect(fireEvent.keyDown(document.body, { key: "/" })).toBe(false);
    expect(document.activeElement).toBe(box());
  });

  it("/ typed in a field stays there; F without Ctrl or other keys do nothing", async () => {
    await show();
    const other = document.createElement("textarea");
    document.body.append(other);
    other.focus();
    expect(fireEvent.keyDown(other, { key: "/" })).toBe(true);
    expect(fireEvent.keyDown(document.body, { key: "f", code: "KeyF" })).toBe(true);
    expect(fireEvent.keyDown(document.body, { key: "g", code: "KeyG", ctrlKey: true })).toBe(true);
    expect(document.activeElement).toBe(other);
    other.remove();
  });

  it("Ctrl+F works even from another field", async () => {
    await show();
    const other = document.createElement("input");
    document.body.append(other);
    other.focus();
    fireEvent.keyDown(other, { key: "f", code: "KeyF", ctrlKey: true });
    expect(document.activeElement).toBe(box());
    other.remove();
  });

  it("the command menu's Search moves here; not after the field is gone", async () => {
    await show();
    act(() => searchFocusRequested());
    expect(document.activeElement).toBe(box());
    box().blur();
    cleanup();
    act(() => searchFocusRequested());
    expect(document.activeElement).toBe(document.body);
  });

  it("once gone, Ctrl+F is the browser's again", async () => {
    await show();
    cleanup();
    expect(fireEvent.keyDown(document.body, { key: "f", code: "KeyF", ctrlKey: true })).toBe(true);
  });
});
