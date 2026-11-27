// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { allSettled, createWatch, fork, type Scope } from "effector";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { $status, fetchStatusFx } from "../model/auth";
import { fetchCalendarsFx } from "../model/calendars";
import { $weekNumbers } from "../model/display";
import { $draft } from "../model/editor";
import { fetchEventsFx, refreshRequested } from "../model/events";
import { narrowChanged, sidebarToggled } from "../model/sidebar";
import { $cursor, $view, dateSelected, viewChanged } from "../model/view";
import { setLang } from "../shared/i18n";
import type { ViewMode } from "../shared/lib/date";
import { CALENDARS, ME, appScope, renderIn } from "./app-scope.test-utils";
import { Toolbar } from "./Toolbar";
import { ViewMenu } from "./ViewMenu";

vi.hoisted(() => {
  window.matchMedia ??= ((media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} })) as never;
});

const mocks = vi.hoisted(() => ({ tauri: false, invoke: vi.fn(async (_cmd: string) => undefined) }));
vi.mock("../shared/api/bus", async (real) => ({
  ...(await real<object>()),
  get inTauri() {
    return mocks.tauri;
  },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

// Wednesday, November 11, 2026; the English week is Sunday 8 – Saturday 14
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 11, 12));
  setLang("en");
  localStorage.clear();
  mocks.tauri = false;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  setLang("ru");
});

const show = async ({ view = "week" as ViewMode, weekNumbers = false } = {}) => {
  const scope: Scope = await appScope({ values: [[$weekNumbers, weekNumbers]] });
  await allSettled(viewChanged, { scope, params: view });
  await allSettled(dateSelected, { scope, params: new Date(2026, 10, 11) });
  renderIn(scope, <Toolbar />);
  return scope;
};

const button = (name: string) => screen.getByRole("button", { name });
const heading = () => screen.getByRole("heading", { level: 2 });

describe("toolbar", () => {
  it("the title names the period on screen", async () => {
    await show();
    // Intl puts thin spaces around the dash
    expect(heading().textContent).toMatch(/^November 8\s–\s14, 2026$/);
    cleanup();
    await show({ view: "month" });
    expect(heading().textContent).toBe("November 2026");
  });

  it("the week number joins the title of the week and day views when turned on", async () => {
    await show({ weekNumbers: true });
    expect(heading().querySelector("[class*=week]")?.textContent).toBe("Week 46");
    cleanup();
    await show({ view: "day", weekNumbers: true });
    expect(heading().textContent).toMatch(/Week 46$/);
    cleanup();
    await show({ view: "month", weekNumbers: true });
    expect(heading().textContent).toBe("November 2026");
    cleanup();
    await show();
    expect(heading().querySelector("[class*=week]")).toBeNull();
  });

  it("Today, Back and Forward move the period", async () => {
    const scope = await show();
    expect(button("Today").title).toBe("Today (T)");
    expect(button("Back").title).toBe("Back (←)");
    expect(button("Forward").title).toBe("Forward (→)");
    fireEvent.click(button("Forward"));
    expect(scope.getState($cursor)).toEqual(new Date(2026, 10, 18));
    fireEvent.click(button("Back"));
    fireEvent.click(button("Back"));
    expect(scope.getState($cursor)).toEqual(new Date(2026, 10, 4));
    fireEvent.click(button("Today"));
    expect(scope.getState($cursor)).toEqual(new Date(2026, 10, 11));
  });

  it("the view tabs switch the view and show their key", async () => {
    const scope = await show();
    const tabs = within(screen.getByRole("tablist", { name: "View" })).getAllByRole("tab");
    expect(tabs.map((t) => `${t.textContent} ${t.title}`)).toEqual(["Day Day (D)", "Week Week (W)", "Month Month (M)", "Schedule Schedule (A)"]);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(tabs[1].className).toContain("active");
    expect(tabs[0].className).not.toContain("active");
    fireEvent.click(tabs[2]);
    expect(scope.getState($view)).toBe("month");
  });

  it("Refresh reloads and spins while loading", async () => {
    const scope = await show();
    const refreshed = vi.fn();
    createWatch({ unit: refreshRequested, scope, fn: refreshed });
    expect(button("Refresh").className).not.toContain("spinning");
    fireEvent.click(button("Refresh"));
    expect(refreshed).toHaveBeenCalledTimes(1);
  });

  it("the refresh button spins while events load", async () => {
    const status = { clientSource: "build" as const, accounts: [{ email: ME, signedIn: true }] };
    const scope = fork({
      values: [[$status, status]] as never,
      handlers: [
        [fetchStatusFx, async () => status],
        [fetchCalendarsFx, async () => ({ calendars: CALENDARS, failed: [], lost: [] })],
        [fetchEventsFx, () => new Promise(() => {})],
      ] as never,
    });
    void allSettled(fetchCalendarsFx, { scope, params: { accounts: [ME], id: 1 } });
    await act(async () => {});
    renderIn(scope, <Toolbar />);
    expect(button("Refresh").className).toContain("spinning");
  });

  it("the side panel button says whether the panel is shown; without the panel New event moves here", async () => {
    const scope = await show();
    const panel = button("Side panel");
    expect(panel.title).toBe("Side panel");
    expect(panel.getAttribute("aria-controls")).toBe("sidebar");
    expect(panel.getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByRole("button", { name: "New event" })).toBeNull();
    fireEvent.click(panel);
    expect(panel.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button("New event"));
    expect(scope.getState($draft)).toMatchObject({ title: "" });
    await act(() => allSettled(sidebarToggled, { scope }));
    await act(() => allSettled(narrowChanged, { scope, params: true }));
    expect(button("Side panel").getAttribute("aria-expanded")).toBe("false");
  });

  it("search and free time sit in the toolbar", async () => {
    await show();
    expect(screen.getByRole("textbox", { name: "Search events" })).toBeTruthy();
    expect(button("Free time")).toBeTruthy();
  });
});

describe("settings button", () => {
  it("in a browser the gear opens settings over the page", async () => {
    await show();
    fireEvent.click(button("Settings"));
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("in the app the gear opens the settings window", async () => {
    mocks.tauri = true;
    await show();
    fireEvent.click(button("Settings"));
    expect(mocks.invoke).toHaveBeenCalledWith("open_settings");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("view menu of a narrow window", () => {
  const VIEWS = [
    { id: "day" as const, key: "D" },
    { id: "week" as const, key: "W" },
    { id: "month" as const, key: "M" },
  ];
  const menu = (value: ViewMode = "week") => {
    const onChange = vi.fn();
    const view = render(<ViewMenu views={VIEWS} value={value} onChange={onChange} className="extra" />);
    const toggle = screen.getByRole("button", { name: `View: ${value === "week" ? "Week" : "Day"}` });
    return { onChange, toggle, view };
  };
  const items = () => screen.getAllByRole("menuitemradio");

  it("one button names the view; it opens the list with the cursor on the current view", () => {
    const { toggle, view } = menu();
    expect(view.container.firstElementChild?.className).toContain("extra");
    expect(toggle.textContent).toBe("Week");
    expect(toggle.getAttribute("aria-haspopup")).toBe("menu");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("menu", { name: "View" })).toBeTruthy();
    expect(items().map((i) => i.textContent)).toEqual(["DayD", "WeekW", "MonthM"]);
    expect(items()[1].getAttribute("aria-checked")).toBe("true");
    expect(items()[1].className).toContain("current");
    expect(items()[0].className).not.toContain("current");
    expect(document.activeElement).toBe(items()[1]);
    fireEvent.click(toggle);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("a click picks the view, closes the list and gives the focus back", () => {
    const { toggle, onChange } = menu();
    fireEvent.click(toggle);
    fireEvent.click(items()[2]);
    expect(onChange).toHaveBeenCalledWith("month");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });

  it("arrows go round the list, Esc closes it; the keys stay inside the menu", () => {
    const { toggle } = menu();
    const outside = vi.fn();
    window.addEventListener("keydown", outside);
    fireEvent.click(toggle);
    expect(fireEvent.keyDown(items()[1], { key: "ArrowDown" })).toBe(false);
    expect(document.activeElement).toBe(items()[2]);
    fireEvent.keyDown(items()[2], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items()[0]);
    fireEvent.keyDown(items()[0], { key: "ArrowUp" });
    expect(document.activeElement).toBe(items()[2]);
    expect(fireEvent.keyDown(items()[2], { key: "a" })).toBe(true);
    expect(document.activeElement).toBe(items()[2]);
    fireEvent.keyDown(items()[2], { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(toggle);
    expect(outside).not.toHaveBeenCalled();
    fireEvent.keyDown(toggle, { key: "ArrowDown" });
    expect(outside).toHaveBeenCalledTimes(1);
    window.removeEventListener("keydown", outside);
  });

  it("the list closes when the focus leaves the menu, not when it moves inside", () => {
    const { toggle } = menu();
    fireEvent.click(toggle);
    fireEvent.blur(items()[1], { relatedTarget: items()[0] });
    expect(screen.queryByRole("menu")).not.toBeNull();
    fireEvent.blur(items()[0], { relatedTarget: document.body });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
