// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { allSettled, createWatch, type Scope } from "effector";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { $draft, eventMoved, eventOpened, eventPatched } from "../model/editor";
import { freeSlotsRequested } from "../model/free";
import { $query, searchFocusRequested, searchRequested } from "../model/search";
import { shortcutsRequested } from "../model/shortcuts";
import { $cursor, $view, todayClicked } from "../model/view";
import { welcomeRequested } from "../model/welcome";
import type { CalendarEvent } from "../shared/api/types";
import { setLang } from "../shared/i18n";
import { localTimeZone } from "../shared/lib/date";
import { MINE, SHARED, appScope, event, renderIn } from "./app-scope.test-utils";
import { CommandMenu } from "./CommandMenu";

// Wednesday, November 11, 2026, 12:00
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 11, 12, 0));
  setLang("en");
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  document.querySelector("main")?.remove();
  vi.useRealTimers();
  setLang("ru");
});

const watch = (scope: Scope, unit: Parameters<typeof createWatch>[0]["unit"]) => {
  const fn = vi.fn();
  createWatch({ unit, scope, fn });
  return fn;
};

const show = async (events: CalendarEvent[] = []) => {
  const scope = await appScope({ events });
  const view = renderIn(scope, <CommandMenu />);
  return { scope, view };
};

const ctrlK = (over: KeyboardEventInit = {}) => {
  let result = true;
  act(() => void (result = fireEvent.keyDown(document.activeElement ?? window, { code: "KeyK", key: "k", ctrlKey: true, ...over })));
  return result;
};
const box = () => screen.getByRole("combobox", { name: "Commands" }) as HTMLInputElement;
const labels = () => screen.getAllByRole("option").map((o) => o.textContent);
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });
const press = (key: string) => fireEvent.keyDown(box(), { key });
const selected = () => screen.getAllByRole("option").find((o) => o.getAttribute("aria-selected") === "true")?.textContent;

/** an event block of the page, as the week grid draws it */
const block = (key: string) => {
  const main = document.createElement("main");
  main.innerHTML = `<button data-event-key="${key}"><span>inside</span></button>`;
  document.body.append(main);
  (main.querySelector("span") as HTMLElement).tabIndex = -1;
  (main.querySelector("span") as HTMLElement).focus();
};

describe("opening and closing", () => {
  it("Ctrl+K or Cmd+K opens the menu with the cursor in its line; Ctrl+K again closes it", async () => {
    await show();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(ctrlK()).toBe(false);
    expect(screen.getByRole("dialog", { name: "Commands" }).getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(box());
    expect(box().getAttribute("aria-expanded")).toBe("true");
    expect(box().getAttribute("aria-controls")).toBe("command-menu-list");
    expect(box().getAttribute("spellcheck")).toBe("false");
    expect(screen.getByRole("listbox", { name: "Commands" }).id).toBe("command-menu-list");
    ctrlK();
    expect(screen.queryByRole("dialog")).toBeNull();
    ctrlK({ ctrlKey: false, metaKey: true });
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });

  it("other keys don't open it: K alone, with Alt, another letter", async () => {
    await show();
    ctrlK({ ctrlKey: false });
    ctrlK({ altKey: true });
    ctrlK({ code: "KeyJ" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Esc and a click beside it close it; a click inside doesn't", async () => {
    await show();
    ctrlK();
    expect(press("Escape")).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    ctrlK();
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).not.toBeNull();
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("once the window is gone Ctrl+K does nothing", async () => {
    const { view } = await show();
    view.unmount();
    expect(ctrlK()).toBe(true);
  });
});

describe("the list", () => {
  it("an empty line offers the usual commands, the first one chosen", async () => {
    await show();
    ctrlK();
    expect(labels()).toEqual(["New event", "Today", "Day", "Week", "Month", "Schedule", "Keyboard shortcuts", "What Calm Calendar can do"]);
    expect(selected()).toBe("New event");
    expect(screen.getAllByRole("option")[0].className).toContain("active");
    expect(screen.getAllByRole("option")[1].className).not.toContain("active");
    expect(box().getAttribute("aria-activedescendant")).toBe("command-menu-list-0");
  });

  it("arrows move the choice round the list and keep the page still; other keys don't move it", async () => {
    await show();
    ctrlK();
    expect(press("ArrowUp")).toBe(false);
    expect(selected()).toBe("What Calm Calendar can do");
    expect(box().getAttribute("aria-activedescendant")).toBe("command-menu-list-7");
    expect(press("ArrowDown")).toBe(false);
    expect(press("ArrowDown")).toBe(false);
    expect(selected()).toBe("Today");
    expect(press("a")).toBe(true);
    expect(selected()).toBe("Today");
  });

  it("the mouse chooses by hovering and doesn't take the focus", async () => {
    await show();
    ctrlK();
    fireEvent.mouseMove(screen.getByRole("option", { name: "Month" }));
    expect(selected()).toBe("Month");
    expect(fireEvent.mouseDown(screen.getByRole("option", { name: "Month" }))).toBe(false);
  });

  it("typing starts the choice from the top again", async () => {
    await show();
    ctrlK();
    press("ArrowDown");
    press("ArrowDown");
    type("week");
    expect(labels()).toEqual(["Create “week”", "Search for “week”", "Week"]);
    expect(selected()).toBe("Create “week”");
  });
});

describe("running a command", () => {
  it("Enter runs the chosen one and closes the menu", async () => {
    const { scope } = await show();
    const today = watch(scope, todayClicked);
    ctrlK();
    press("ArrowDown");
    expect(press("Enter")).toBe(false);
    expect(today).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a click runs it too: a view, a new event, the shortcuts, the card of features", async () => {
    const { scope } = await show();
    const shortcuts = watch(scope, shortcutsRequested);
    const welcome = watch(scope, welcomeRequested);
    for (const name of ["Month", "New event", "Keyboard shortcuts", "What Calm Calendar can do"]) {
      ctrlK();
      fireEvent.click(screen.getByRole("option", { name }));
    }
    expect(scope.getState($view)).toBe("month");
    expect(scope.getState($draft)).toMatchObject({ title: "", calendarId: MINE });
    expect(shortcuts).toHaveBeenCalledTimes(1);
    expect(welcome).toHaveBeenCalledTimes(1);
  });

  it("a date goes to that day", async () => {
    const { scope } = await show();
    ctrlK();
    type("friday");
    expect(labels()[0]).toMatch(/^Go to Fri/);
    press("Enter");
    expect(scope.getState($cursor)).toEqual(new Date(2026, 10, 13));
  });

  it("Create opens the form with the parsed line in the first writable calendar", async () => {
    const { scope } = await show();
    ctrlK();
    type("lunch tomorrow 1pm");
    press("Enter");
    expect(scope.getState($draft)).toMatchObject({
      calendarId: MINE,
      title: "Lunch",
      startDate: "2026-11-12",
      startTime: "13:00",
      timeZone: localTimeZone(),
      guests: [],
      addMeet: false,
      attachments: [],
    });
  });

  it("Search looks for the text and moves to the search field", async () => {
    const { scope } = await show();
    const asked = watch(scope, searchRequested);
    const focus = watch(scope, searchFocusRequested);
    ctrlK();
    type("dentist");
    press("ArrowDown");
    press("Enter");
    expect(scope.getState($query)).toBe("dentist");
    expect(asked).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("free time and the theme are found by name", async () => {
    const { scope } = await show();
    const free = watch(scope, freeSlotsRequested);
    ctrlK();
    type("free");
    fireEvent.click(screen.getByRole("option", { name: "Free time" }));
    expect(free).toHaveBeenCalledTimes(1);
    ctrlK();
    type("dark");
    fireEvent.click(screen.getByRole("option", { name: "Theme: Dark" }));
    expect(JSON.parse(localStorage.getItem("calm.theme") ?? "null")).toBe("dark");
  });
});

describe("the selected event", () => {
  const dentist = event();

  it("the focused block's event: its title and its actions come first", async () => {
    await show([dentist]);
    block("k1");
    ctrlK();
    expect(screen.getByText("Dentist", { selector: "p" })).toBeTruthy();
    expect(labels().slice(0, 3)).toEqual(["Move to tomorrow", "An hour later", "Add Google Meet video call"]);
  });

  it("to tomorrow and an hour later move it", async () => {
    const { scope } = await show([dentist]);
    const moves = watch(scope, eventMoved);
    block("k1");
    ctrlK();
    press("Enter");
    expect(moves).toHaveBeenLastCalledWith({ event: dentist, start: new Date(2026, 10, 12, 16), end: new Date(2026, 10, 12, 16, 45) });
    cleanup();
    document.querySelector("main")?.remove();
    const again = await show([dentist]);
    const later = watch(again.scope, eventMoved);
    block("k1");
    ctrlK();
    press("ArrowDown");
    press("Enter");
    expect(later).toHaveBeenCalledWith({ event: dentist, start: new Date(2026, 10, 11, 17), end: new Date(2026, 10, 11, 17, 45) });
  });

  it("a video call and a color change it", async () => {
    const { scope } = await show([dentist]);
    const patches = watch(scope, eventPatched);
    block("k1");
    ctrlK();
    fireEvent.click(screen.getByRole("option", { name: "Add Google Meet video call" }));
    expect(patches).toHaveBeenLastCalledWith({ event: dentist, patch: { addMeet: true } });
    block("k1");
    ctrlK();
    type("tomato");
    fireEvent.click(screen.getByRole("option", { name: "Color: Tomato" }));
    expect(patches).toHaveBeenLastCalledWith({ event: dentist, patch: { colorId: "11" } });
  });

  it("an all-day event can't go an hour later; one with a call gets no second call", async () => {
    const allDay = event({ allDay: true, start: new Date(2026, 10, 11), end: new Date(2026, 10, 12) });
    await show([allDay]);
    block("k1");
    ctrlK();
    expect(labels().slice(0, 2)).toEqual(["Move to tomorrow", "Add Google Meet video call"]);
    cleanup();
    document.querySelector("main")?.remove();
    await show([event({ meeting: { provider: "Zoom", url: "https://zoom.us/j/1" } as CalendarEvent["meeting"] })]);
    block("k1");
    ctrlK();
    expect(labels().slice(0, 2)).toEqual(["Move to tomorrow", "An hour later"]);
  });

  it("without a focused block the open card's event is the one", async () => {
    const { scope } = await show([dentist]);
    await allSettled(eventOpened, { scope, params: dentist });
    ctrlK();
    expect(labels()[0]).toBe("Move to tomorrow");
  });

  it("a block of an event that is no longer loaded falls back to the card", async () => {
    const { scope } = await show([]);
    await allSettled(eventOpened, { scope, params: dentist });
    block("gone");
    ctrlK();
    expect(labels()[0]).toBe("Move to tomorrow");
  });

  it("an event of a read-only calendar can't be changed: no actions", async () => {
    await show([event({ calendarId: SHARED })]);
    block("k1");
    ctrlK();
    expect(labels()[0]).toBe("New event");
    expect(screen.queryByText("Dentist", { selector: "p" })).toBeNull();
  });

  it("with nothing selected the actions run nothing", async () => {
    const { scope } = await show();
    const moves = watch(scope, eventMoved);
    ctrlK();
    type("tomorrow");
    expect(labels()).not.toContain("Move to tomorrow");
    expect(moves).not.toHaveBeenCalled();
  });
});
