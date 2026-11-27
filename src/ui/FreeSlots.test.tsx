// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { allSettled, fork, type Scope } from "effector";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { $status, fetchStatusFx } from "../model/auth";
import { fetchCalendarsFx } from "../model/calendars";
import { fetchEventsFx } from "../model/events";
import { freeSlotsRequested } from "../model/free";
import { $cursor, $now, dateSelected, viewChanged } from "../model/view";
import type { CalendarEvent } from "../shared/api/types";
import { setLang } from "../shared/i18n";
import { formatTime } from "../shared/lib/date";
import { CALENDARS, ME, appScope, event, renderIn } from "./app-scope.test-utils";
import { FreeSlotsButton } from "./FreeSlots";

const mocks = vi.hoisted(() => ({ copyText: vi.fn(async (_text: string) => true) }));
vi.mock("../shared/lib/clipboard", () => ({ copyText: mocks.copyText }));

// Wed, November 11, 2026, 12:00; the English week on screen is Sunday 8 – Saturday 14
const NOW = new Date(2026, 10, 11, 12, 0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  setLang("en");
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  setLang("ru");
});

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m);
const busy = (key: string, start: Date, end: Date) => event({ key, id: key, title: key, start, end });

const show = async (events: CalendarEvent[] = [], handlers: [unknown, unknown][] = []) => {
  const scope = await appScope({ events, values: [[$now, NOW]], handlers });
  await allSettled(viewChanged, { scope, params: "week" });
  await allSettled(dateSelected, { scope, params: at(11, 0) });
  renderIn(scope, <FreeSlotsButton />);
  return scope;
};

const open = () => fireEvent.click(screen.getByRole("button", { name: "Free time" }));
const preview = () => screen.getByRole("textbox", { name: "Free time" }) as HTMLTextAreaElement;
const lines = () => preview().value.split("\n");
const copy = () => screen.getByRole("button", { name: /^Cop/ }) as HTMLButtonElement;
const range = (a: Date, b: Date) => `${formatTime(a)}–${formatTime(b)}`;

describe("free time", () => {
  it("the clock button opens it; the cross, Esc and a click beside it close it", async () => {
    await show();
    const button = screen.getByRole("button", { name: "Free time" });
    expect(button.title).toBe("Free time");
    expect(screen.queryByRole("dialog")).toBeNull();
    for (const close of [
      () => fireEvent.click(screen.getByRole("button", { name: "Close" })),
      () => fireEvent.keyDown(window, { key: "Escape" }),
      () => fireEvent.mouseDown(screen.getByRole("dialog").parentElement as HTMLElement),
    ]) {
      open();
      fireEvent.keyDown(window, { key: "Enter" });
      fireEvent.mouseDown(screen.getByRole("dialog"));
      expect(screen.getByRole("dialog", { name: "Free time" }).getAttribute("aria-modal")).toBe("true");
      close();
      expect(screen.queryByRole("dialog")).toBeNull();
    }
  });

  it("the command menu's Free time opens it too; not after the button is gone", async () => {
    await show();
    act(() => freeSlotsRequested());
    expect(screen.getByRole("dialog")).toBeTruthy();
    cleanup();
    act(() => freeSlotsRequested());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("from now to the end of the work day, the weekdays left on screen, around busy time", async () => {
    await show([busy("call", at(12, 10), at(12, 11))]);
    open();
    expect(lines()[0]).toMatch(/^When I'm free \(/);
    expect(lines().slice(1)).toEqual([
      `Wed, November 11: ${range(at(11, 12), at(11, 18))}`,
      `Thu, November 12: ${range(at(12, 9), at(12, 10))} and ${range(at(12, 11), at(12, 18))}`,
      `Fri, November 13: ${range(at(13, 9), at(13, 18))}`,
    ]);
  });

  it("hours, the shortest gap and weekends change the list and are remembered", async () => {
    await show([busy("call", at(12, 10), at(12, 11))]);
    open();
    const [from, to] = screen.getAllByDisplayValue(/^\d\d:\d\d$/) as HTMLInputElement[];
    expect([from.value, to.value]).toEqual(["09:00", "18:00"]);
    fireEvent.change(from, { target: { value: "10:00" } });
    fireEvent.change(to, { target: { value: "17:30" } });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "120" } });
    expect(lines()).toContain(`Thu, November 12: ${range(at(12, 11), at(12, 17, 30))}`);
    fireEvent.click(screen.getByRole("checkbox", { name: "Include weekends" }));
    expect(lines().at(-1)).toBe(`Sat, November 14: ${range(at(14, 10), at(14, 17, 30))}`);
    expect(JSON.parse(localStorage.getItem("calm.freeSlots") ?? "{}")).toEqual({ from: 600, to: 1050, minLength: 120, weekends: true });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    open();
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("120");
    expect((screen.getByRole("checkbox", { name: "Include weekends" }) as HTMLInputElement).checked).toBe(true);
  });

  it("the shortest gap offers 15 minutes to 2 hours", async () => {
    await show();
    open();
    expect([...(screen.getByRole("combobox") as HTMLSelectElement).options].map((o) => o.text)).toEqual([
      "15 min",
      "30 min",
      "60 min",
      "90 min",
      "120 min",
    ]);
  });

  it("an end before the start, or an emptied time, changes nothing", async () => {
    await show();
    open();
    const [from, to] = screen.getAllByDisplayValue(/^\d\d:\d\d$/) as HTMLInputElement[];
    fireEvent.change(from, { target: { value: "19:00" } });
    fireEvent.change(to, { target: { value: "09:00" } });
    fireEvent.change(to, { target: { value: "" } });
    expect([from.value, to.value]).toEqual(["09:00", "18:00"]);
    expect(localStorage.getItem("calm.freeSlots")).toBeNull();
  });

  it("broken saved choices fall back to the usual ones", async () => {
    localStorage.setItem("calm.freeSlots", JSON.stringify({ from: 1000, to: 500, minLength: 45, weekends: "yes" }));
    await show();
    open();
    const [from, to] = screen.getAllByDisplayValue(/^\d\d:\d\d$/) as HTMLInputElement[];
    expect([from.value, to.value]).toEqual(["09:00", "18:00"]);
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("30");
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    cleanup();
    localStorage.setItem("calm.freeSlots", JSON.stringify({ from: -5, to: 2000, minLength: 15, weekends: true }));
    await show();
    open();
    const [f2, t2] = screen.getAllByDisplayValue(/^\d\d:\d\d$/) as HTMLInputElement[];
    expect([f2.value, t2.value]).toEqual(["09:00", "18:00"]);
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("15");
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  });

  it("Copy copies the text and says so until the next change", async () => {
    await show();
    open();
    expect(copy().textContent).toBe("Copy");
    await act(async () => void fireEvent.click(copy()));
    expect(mocks.copyText).toHaveBeenCalledWith(preview().value);
    expect(copy().textContent).toBe("Copied");
    fireEvent.click(screen.getByRole("checkbox", { name: "Include weekends" }));
    expect(copy().textContent).toBe("Copy");
  });

  it("no free time: says why, offers the next days, nothing to copy", async () => {
    const scope = await show([busy("a", at(11, 12), at(11, 18)), busy("b", at(12, 9), at(12, 18)), busy("c", at(13, 9), at(13, 18))]);
    open();
    expect(screen.getByRole("status").textContent).toBe("No free time No free time left in these hours on the days on screen.");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(copy().disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Show the next days" }));
    expect(scope.getState($cursor)).toEqual(at(18, 0));
  });

  it("with free time there is no Show the next days", async () => {
    await show();
    open();
    expect(screen.queryByRole("button", { name: "Show the next days" })).toBeNull();
    expect(copy().disabled).toBe(false);
  });

  it("while the days load it waits instead of calling them free", async () => {
    const status = { clientSource: "build" as const, accounts: [{ email: ME, signedIn: true }] };
    const scope: Scope = fork({
      values: [[$status, status], [$now, NOW]] as never,
      handlers: [
        [fetchStatusFx, async () => status],
        [fetchCalendarsFx, async () => ({ calendars: CALENDARS, failed: [], lost: [] })],
        [fetchEventsFx, () => new Promise(() => {})],
      ] as never,
    });
    void allSettled(fetchCalendarsFx, { scope, params: { accounts: [ME], id: 1 } });
    await act(async () => {});
    renderIn(scope, <FreeSlotsButton />);
    open();
    expect(screen.getByRole("status").textContent).toBe("Loading…");
    expect(copy().disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Show the next days" })).toBeNull();
  });

  it("days that failed to load are not called free", async () => {
    await show([], [[fetchEventsFx, async ({ id }: { id: number }) => ({ events: [], failed: ["Work"], lost: false, id })]]);
    open();
    expect(screen.getByRole("status").textContent).toBe("Couldn't load calendars: Work");
    expect(copy().disabled).toBe(true);
  });
});

describe("saved choices", () => {
  const saved = (o: object) => localStorage.setItem("calm.freeSlots", JSON.stringify(o));
  const times = () => (screen.getAllByDisplayValue(/^\d\d:\d\d$/) as HTMLInputElement[]).map((i) => i.value);

  it("valid hours are kept, from midnight to midnight included", async () => {
    saved({ from: 600, to: 1020, minLength: 60, weekends: false });
    await show();
    open();
    expect(times()).toEqual(["10:00", "17:00"]);
    cleanup();
    saved({ from: 0, to: 1440, minLength: 60, weekends: false });
    await show();
    open();
    expect(times()).toEqual(["00:00", "00:00"]);
    expect(lines()[1]).toMatch(/^Wed, November 11: 12:00 PM–12:00 AM/);
  });

  it("hours that are not numbers, or an empty day, fall back to the usual ones", async () => {
    saved({ from: "600", to: 1020 });
    await show();
    open();
    expect(times()).toEqual(["09:00", "17:00"]);
    cleanup();
    saved({ from: 600, to: 600 });
    await show();
    open();
    expect(times()).toEqual(["09:00", "18:00"]);
  });
});
