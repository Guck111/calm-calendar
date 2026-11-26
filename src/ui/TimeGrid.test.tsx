// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { allSettled, createWatch, type Scope } from "effector";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { $draft, $opened, eventMoved } from "../model/editor";
import { $cursor, $now, $today, $view, dateSelected, viewChanged } from "../model/view";
import { $secondZoneSetting } from "../model/zones";
import type { CalendarEvent } from "../shared/api/types";
import { setLang } from "../shared/i18n";
import { formatTime } from "../shared/lib/date";
import { ME, SHARED, WORK, WORK_CAL, appScope, event, renderIn } from "./app-scope.test-utils";
import { TimeGrid } from "./TimeGrid";

// Wednesday, November 11, 2026, 12:00; in English the week is Sunday 8 – Saturday 14
const NOW = new Date(2026, 10, 11, 12, 0);
/** the day body is 1440 px high and 7 × 100 px wide after the hours column: a pixel is a minute */
const BODY = { top: 0, left: 0, width: 56 + 700, height: 1440 };

beforeEach(() => {
  setLang("en");
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ ...BODY, x: 0, y: 0, right: BODY.width, bottom: BODY.height, toJSON: () => ({}) } as DOMRect);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setLang("ru");
});

const show = async ({
  events = [],
  view = "week",
  secondZone,
  accounts,
}: { events?: CalendarEvent[]; view?: "week" | "day"; secondZone?: string; accounts?: string[] } = {}) => {
  const scope: Scope = await appScope({
    accounts,
    events,
    values: [
      [$now, NOW],
      [$today, new Date(2026, 10, 11)],
      [$secondZoneSetting, { enabled: Boolean(secondZone), zone: secondZone ?? "UTC" }],
    ],
  });
  await allSettled(viewChanged, { scope, params: view });
  await allSettled(dateSelected, { scope, params: new Date(2026, 10, 11) });
  const moves = vi.fn();
  createWatch({ unit: eventMoved, scope, fn: moves });
  const rendered = renderIn(scope, <TimeGrid />);
  return { scope, moves, container: rendered.container };
};

const block = (title: string) => screen.getByRole("button", { name: new RegExp(title) });
const byKey = (key: string) => document.querySelector<HTMLElement>(`button[data-event-key="${key}"]`) as HTMLElement;
/** a position in the day as the style has it (six significant digits, as jsdom keeps it) */
const pct = (minutes: number) => `${+((minutes * 100) / 1440).toPrecision(6)}%`;
const columns = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>("[class*=column]")];
const pointer = (type: "pointermove" | "pointerup", x: number, y: number) =>
  act(() => void window.dispatchEvent(Object.assign(new Event(type), { clientX: x, clientY: y })));

describe("week grid", () => {
  it("seven day heads from Sunday, today marked; a head opens its day", async () => {
    const { scope } = await show();
    const heads = screen.getAllByRole("button").filter((b) => b.className.includes("dayHead"));
    expect(heads.map((h) => h.textContent)).toEqual(["Sun8", "Mon9", "Tue10", "Wed11", "Thu12", "Fri13", "Sat14"]);
    expect(heads.filter((h) => h.className.includes("today")).map((h) => h.textContent)).toEqual(["Wed11"]);
    fireEvent.click(heads[5]);
    expect(scope.getState($view)).toBe("day");
    expect(scope.getState($cursor)).toEqual(new Date(2026, 10, 13));
  });

  it("the day view has one column and its head opens nothing", async () => {
    const { container } = await show({ view: "day" });
    expect(columns(container)).toHaveLength(1);
    expect(container.firstElementChild?.className).toContain("single");
    const head = screen.getAllByRole("button").find((b) => b.className.includes("dayHead")) as HTMLButtonElement;
    expect(head.disabled).toBe(true);
  });

  it("the hours column labels every hour but midnight", async () => {
    const { container } = await show();
    const hours = [...(container.querySelector("[class*=hours]") as HTMLElement).children].map((h) => h.textContent);
    expect(hours).toHaveLength(24);
    expect(hours[0]).toBe("");
    expect(hours[1]).not.toBe("");
  });

  it("the now line is in today's column at the current minute", async () => {
    const { container } = await show();
    const now = container.querySelectorAll<HTMLElement>("[class*=now]");
    expect(now).toHaveLength(1);
    expect(now[0].parentElement?.className).toContain("todayColumn");
    expect(now[0].style.top).toBe(pct(12 * 60));
  });

  it("the second time zone adds a labelled hours column and both zone names", async () => {
    const { container } = await show({ secondZone: "Asia/Tokyo" });
    expect(container.querySelectorAll("[class*=zoneHead]")).toHaveLength(2);
    expect(container.querySelector("[class*=secondHours]")?.getAttribute("aria-label")).toMatch(/Tokyo/);
    expect(container.querySelectorAll("[class*=secondHours] [class*=hour]")).toHaveLength(24);
    cleanup();
    const plain = await show();
    expect(plain.container.querySelector("[class*=zoneHead]")).toBeNull();
  });

  it("an event shows its title and time, sits at its time and is dimmed once over", async () => {
    const { container } = await show({
      events: [event({ title: "Dentist" }), event({ key: "k0", id: "k0", title: "Breakfast", start: new Date(2026, 10, 11, 8), end: new Date(2026, 10, 11, 9) })],
    });
    const dentist = block("Dentist");
    expect(dentist.title).toBe(`${formatTime(event().start)}–${formatTime(event().end)} Dentist`);
    expect(dentist.style.top).toBe(pct(16 * 60));
    expect(dentist.style.height).toBe(pct(45));
    expect(dentist.className).not.toContain("past");
    expect(block("Breakfast").className).toContain("past");
    // 45 minutes is not short, less is
    expect(dentist.className).not.toContain("short");
    expect(columns(container)[3].contains(dentist)).toBe(true);
  });

  it("a short event, a recurring one, and two at once side by side", async () => {
    await show({
      events: [
        event({ key: "a", id: "a", title: "Quick", start: new Date(2026, 10, 12, 9), end: new Date(2026, 10, 12, 9, 30), recurring: true }),
        event({ key: "b", id: "b", title: "Other", start: new Date(2026, 10, 12, 9), end: new Date(2026, 10, 12, 10) }),
      ],
    });
    expect(block("Quick").className).toContain("short");
    expect(block("Quick").querySelector("svg")).not.toBeNull();
    const widths = [block("Quick").style.width, block("Other").style.width];
    expect(widths).toEqual(["calc(50% - 3px)", "calc(50% - 3px)"]);
    expect([block("Quick").style.insetInlineStart, block("Other").style.insetInlineStart].sort()).toEqual([
      "calc(0% + 1px)",
      "calc(50% + 1px)",
    ]);
  });

  it("an overlap with another account is marked and named", async () => {
    await show({
      accounts: [ME, WORK],
      events: [event(), event({ key: "w", id: "w", calendarId: WORK_CAL, account: WORK, title: "Call" })],
    });
    const mark = within(byKey("k1")).getByRole("img");
    expect(mark.getAttribute("aria-label")).toBe("Overlaps with: Call");
    expect(byKey("k1").title).toContain("\nOverlaps with: Call");
    expect(byKey("k1").className).toContain("conflict");
  });

  it("travel time is a stripe above the event, named when it is long enough", async () => {
    const { container } = await show({
      events: [
        event({ travelMinutes: 30 }),
        event({ key: "s", id: "s", title: "Gym", start: new Date(2026, 10, 12, 18), end: new Date(2026, 10, 12, 19), travelMinutes: 10 }),
      ],
    });
    const stripes = [...container.querySelectorAll<HTMLElement>("[class*=travel]")];
    expect(stripes.map((s) => s.title)).toEqual(["Travel: 30 min", "Travel: 10 min"]);
    expect(stripes[0].textContent).toBe("Travel");
    expect(stripes[1].textContent).toBe("");
    expect(stripes[0].style.top).toBe(pct(15 * 60 + 30));
    expect(stripes[0].style.height).toBe(pct(30));
  });

  it("all-day events get their own row with a label; the row is gone without them", async () => {
    const holiday = event({ key: "h", id: "h", title: "Holiday", allDay: true, start: new Date(2026, 10, 11), end: new Date(2026, 10, 12) });
    const { scope, container } = await show({ events: [holiday] });
    expect(screen.getByText("all day")).toBeTruthy();
    expect(block("Holiday").className).not.toContain("past");
    fireEvent.click(block("Holiday"));
    expect(scope.getState($opened)?.key).toBe("h");
    cleanup();
    await show();
    expect(screen.queryByText("all day")).toBeNull();
    expect(container).toBeTruthy();
  });

  it("an all-day event of yesterday is dimmed", async () => {
    await show({ events: [event({ key: "y", id: "y", title: "Old", allDay: true, start: new Date(2026, 10, 10), end: new Date(2026, 10, 11) })] });
    expect(block("Old").className).toContain("past");
  });
});

describe("clicks on the grid", () => {
  it("a click on an empty spot creates an event at that half hour", async () => {
    const { scope, container } = await show();
    fireEvent.click(columns(container)[4], { clientY: 10 * 60 + 50 });
    expect(scope.getState($draft)).toMatchObject({ startDate: "2026-11-12", startTime: "10:30" });
  });

  it("a click at the very bottom starts at 23:30 at the latest", async () => {
    const { scope, container } = await show();
    fireEvent.click(columns(container)[4], { clientY: 1440 });
    expect(scope.getState($draft)).toMatchObject({ startDate: "2026-11-12", startTime: "23:30" });
  });

  it("the keyboard opens my event; a mouse click goes through dragging instead", async () => {
    const { scope } = await show({ events: [event()] });
    fireEvent.click(block("Dentist"), { detail: 1 });
    expect(scope.getState($opened)).toBeNull();
    fireEvent.click(block("Dentist"), { detail: 0 });
    expect(scope.getState($opened)?.key).toBe("k1");
  });

  it("someone else's event opens by a click and can't be dragged", async () => {
    const { scope, moves } = await show({ events: [event({ calendarId: SHARED, title: "Board" })] });
    expect(block("Board").className).not.toContain("draggable");
    expect(block("Board").querySelector("[class*=resize]")).toBeNull();
    fireEvent.pointerDown(block("Board"), { button: 0, clientX: 400, clientY: 960 });
    pointer("pointermove", 400, 1020);
    pointer("pointerup", 400, 1020);
    expect(moves).not.toHaveBeenCalled();
    fireEvent.click(block("Board"), { detail: 1 });
    expect(scope.getState($opened)?.key).toBe("k1");
  });
});

describe("dragging", () => {
  const start = event().start;
  const at = (h: number, m = 0, d = 11) => new Date(2026, 10, d, h, m);

  it("a press and release without moving opens the event", async () => {
    const { scope, moves } = await show({ events: [event()] });
    fireEvent.pointerDown(block("Dentist"), { button: 0, clientX: 400, clientY: 960 });
    pointer("pointermove", 402, 962);
    pointer("pointerup", 402, 962);
    expect(moves).not.toHaveBeenCalled();
    expect(scope.getState($opened)?.key).toBe("k1");
  });

  it("dragging down moves the event later, sideways to another day", async () => {
    const { moves } = await show({ events: [event()] });
    expect(block("Dentist").className).toContain("draggable");
    fireEvent.pointerDown(block("Dentist"), { button: 0, clientX: 400, clientY: 960 });
    pointer("pointermove", 400, 1020);
    expect(block("Dentist").className).toContain("dragged");
    pointer("pointermove", 500, 1020);
    pointer("pointerup", 500, 1020);
    expect(moves).toHaveBeenCalledWith(expect.objectContaining({ start: at(17, 0, 12), end: at(17, 45, 12) }));
    expect(block("Dentist").className).not.toContain("dragged");
    expect(start).toEqual(at(16));
  });

  it("in right-to-left the days go the other way", async () => {
    setLang("ar");
    const { moves } = await show({ events: [event()] });
    fireEvent.pointerDown(screen.getAllByRole("button").find((b) => b.getAttribute("data-event-key") === "k1") as HTMLElement, {
      button: 0,
      clientX: 400,
      clientY: 960,
    });
    pointer("pointermove", 500, 960);
    pointer("pointerup", 500, 960);
    expect(moves).toHaveBeenCalledWith(expect.objectContaining({ start: at(16, 0, 10) }));
  });

  it("the bottom edge changes the length only", async () => {
    const { moves } = await show({ events: [event()] });
    const handle = block("Dentist").querySelector("[class*=resize]") as HTMLElement;
    fireEvent.pointerDown(handle, { button: 0, clientX: 400, clientY: 1005 });
    pointer("pointermove", 520, 1035);
    pointer("pointerup", 520, 1035);
    expect(moves).toHaveBeenCalledWith(expect.objectContaining({ start: at(16), end: at(17, 15) }));
  });

  it("moved and brought back: nothing to save, the event doesn't open", async () => {
    const { scope, moves } = await show({ events: [event()] });
    fireEvent.pointerDown(block("Dentist"), { button: 0, clientX: 400, clientY: 960 });
    pointer("pointermove", 400, 1020);
    pointer("pointermove", 400, 961);
    pointer("pointerup", 400, 961);
    expect(moves).not.toHaveBeenCalled();
    expect(scope.getState($opened)).toBeNull();
  });

  it("Esc cancels the drag", async () => {
    const { moves } = await show({ events: [event()] });
    fireEvent.pointerDown(block("Dentist"), { button: 0, clientX: 400, clientY: 960 });
    pointer("pointermove", 400, 1020);
    act(() => void fireEvent.keyDown(window, { key: "Enter" }));
    expect(block("Dentist").className).toContain("dragged");
    act(() => void fireEvent.keyDown(window, { key: "Escape" }));
    pointer("pointerup", 400, 1020);
    expect(moves).not.toHaveBeenCalled();
    expect(block("Dentist").style.top).toBe(pct(16 * 60));
  });

  it("the right button doesn't drag", async () => {
    const { moves } = await show({ events: [event()] });
    fireEvent.pointerDown(block("Dentist"), { button: 2, clientX: 400, clientY: 960 });
    pointer("pointermove", 400, 1020);
    pointer("pointerup", 400, 1020);
    expect(moves).not.toHaveBeenCalled();
  });

  it("after the release the window stops following the mouse", async () => {
    const { moves } = await show({ events: [event()] });
    fireEvent.pointerDown(block("Dentist"), { button: 0, clientX: 400, clientY: 960 });
    pointer("pointermove", 400, 1020);
    pointer("pointerup", 400, 1020);
    pointer("pointermove", 400, 1200);
    pointer("pointerup", 400, 1200);
    expect(moves).toHaveBeenCalledTimes(1);
  });
});

describe("grid details", () => {
  const cls = (el: Element | null | undefined) => el?.className ?? "";

  it("the layout has one hours column, or two with a second zone", async () => {
    const holiday = event({ key: "h", id: "h", title: "Holiday", allDay: true, start: new Date(2026, 10, 11), end: new Date(2026, 10, 12) });
    const { container } = await show({ secondZone: "Asia/Tokyo", events: [holiday] });
    const body = container.querySelector<HTMLElement>("[class*=body]") as HTMLElement;
    expect(body.style.gridTemplateColumns).toBe("repeat(2, 56px) repeat(7, minmax(0px, 1fr))");
    expect(container.querySelector<HTMLElement>("[class*=allDayLabel]")?.style.gridColumn).toBe("span 2");
    expect(cls(container.firstElementChild)).not.toContain("single");
    cleanup();
    const one = await show();
    expect((one.container.querySelector("[class*=body]") as HTMLElement).style.gridTemplateColumns).toBe("repeat(1, 56px) repeat(7, minmax(0px, 1fr))");
  });

  it("a second zone with a half-hour offset labels its hours with minutes, midnight row empty", async () => {
    const { container } = await show({ secondZone: "Asia/Kolkata" });
    const hours = [...container.querySelectorAll("[class*=secondHours] [class*=hour]")].map((h) => h.textContent);
    expect(hours[0]).toBe("");
    expect(hours.slice(1).every((h) => /:30/.test(h ?? ""))).toBe(true);
  });

  it("an event that ends right now counts as over", async () => {
    await show({
      events: [
        event({ title: "Standup", start: new Date(2026, 10, 11, 11, 30), end: NOW }),
        event({ key: "d", id: "d", title: "Day off", allDay: true, start: new Date(2026, 10, 10), end: new Date(2026, 10, 11) }),
      ],
    });
    expect(cls(block("Standup"))).toContain("past");
    expect(cls(block("Day off"))).toContain("past");
  });

  it("travel: none for an all-day event or one at midnight; twenty minutes is named", async () => {
    const { container } = await show({
      events: [
        event({ key: "a", id: "a", title: "Trip", allDay: true, start: new Date(2026, 10, 12), end: new Date(2026, 10, 13), travelMinutes: 30 }),
        event({ key: "m", id: "m", title: "Night", start: new Date(2026, 10, 13, 0), end: new Date(2026, 10, 13, 1), travelMinutes: 30 }),
        event({ key: "t", id: "t", title: "Gym", start: new Date(2026, 10, 14, 18), end: new Date(2026, 10, 14, 19), travelMinutes: 20 }),
      ],
    });
    const stripes = [...container.querySelectorAll<HTMLElement>("[class*=travel]")];
    expect(stripes).toHaveLength(1);
    expect(stripes[0].textContent).toBe("Travel");
  });

  it("several overlaps are named together", async () => {
    const other = (key: string, title: string) => event({ key, id: key, calendarId: WORK_CAL, account: WORK, title });
    await show({ accounts: [ME, WORK], events: [event(), other("a", "Call"), other("b", "Lunch")] });
    expect(within(byKey("k1")).getByRole("img").getAttribute("aria-label")).toBe("Overlaps with: Call, Lunch");
  });

  it("while dragging the event follows the mouse, others stay; the grid is marked", async () => {
    const { container } = await show({ events: [event(), event({ key: "o", id: "o", title: "Other", start: new Date(2026, 10, 12, 9), end: new Date(2026, 10, 12, 10) })] });
    fireEvent.pointerDown(block("Dentist"), { button: 0, clientX: 400, clientY: 960 });
    expect(cls(container.querySelector("[class*=body]"))).not.toContain("dragging");
    pointer("pointermove", 400, 1020);
    expect(cls(container.querySelector("[class*=body]"))).toContain("dragging");
    expect(block("Dentist").style.top).toBe(pct(17 * 60));
    expect(cls(block("Other"))).not.toContain("dragged");
    expect(block("Other").style.top).toBe(pct(9 * 60));
    pointer("pointerup", 400, 1020);
  });

  it("four pixels is still a click, five starts a drag", async () => {
    const { scope, moves } = await show({ events: [event()] });
    fireEvent.pointerDown(block("Dentist"), { button: 0, clientX: 400, clientY: 960 });
    pointer("pointermove", 404, 960);
    pointer("pointerup", 404, 960);
    expect(scope.getState($opened)?.key).toBe("k1");
    expect(moves).not.toHaveBeenCalled();
  });

  it("with a second zone the day width leaves out both hours columns", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ ...BODY, width: 112 + 700, x: 0, y: 0, right: 812, bottom: 1440, toJSON: () => ({}) } as DOMRect);
    const { moves } = await show({ events: [event()], secondZone: "Asia/Tokyo" });
    fireEvent.pointerDown(block("Dentist"), { button: 0, clientX: 400, clientY: 960 });
    pointer("pointermove", 451, 960);
    pointer("pointerup", 451, 960);
    expect(moves).toHaveBeenCalledWith(expect.objectContaining({ start: new Date(2026, 10, 12, 16) }));
  });

  it("a click on an empty spot counts from the top of the column", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ ...BODY, top: 200, y: 200, x: 0, right: BODY.width, bottom: 1640, toJSON: () => ({}) } as DOMRect);
    const { scope, container } = await show();
    fireEvent.click(columns(container)[4], { clientY: 200 + 8 * 60 });
    expect(scope.getState($draft)).toMatchObject({ startTime: "08:00" });
  });

  it("opens scrolled to 7 a.m., or near the current hour later in the day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(2026, 10, 11, 20, 0));
      const evening = await show();
      expect((evening.container.querySelector("[class*=scroll]") as HTMLElement).scrollTop).toBe(52 * 16 - 8);
      cleanup();
      vi.setSystemTime(new Date(2026, 10, 11, 12, 0));
      const noon = await show();
      expect((noon.container.querySelector("[class*=scroll]") as HTMLElement).scrollTop).toBe(52 * 10 - 8);
      cleanup();
      vi.setSystemTime(new Date(2026, 10, 11, 6, 0));
      const morning = await show();
      expect((morning.container.querySelector("[class*=scroll]") as HTMLElement).scrollTop).toBe(52 * 7 - 8);
    } finally {
      vi.useRealTimers();
    }
  });

  it("another week opens at 7 a.m. whatever the time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(2026, 10, 11, 20, 0));
      const scope: Scope = await appScope({ values: [[$now, NOW], [$today, new Date(2026, 10, 11)]] });
      await allSettled(viewChanged, { scope, params: "week" });
      await allSettled(dateSelected, { scope, params: new Date(2026, 10, 25) });
      const { container } = renderIn(scope, <TimeGrid />);
      expect((container.querySelector("[class*=scroll]") as HTMLElement).scrollTop).toBe(52 * 7 - 8);
    } finally {
      vi.useRealTimers();
    }
  });
});
