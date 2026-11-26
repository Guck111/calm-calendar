// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { allSettled, createWatch, type Scope } from "effector";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { $authError, signInCancelClicked, signInFx, signInReopenClicked, signOutClicked } from "../model/auth";
import { $calendarsWithVisibility } from "../model/calendars";
import { $weekNumbers } from "../model/display";
import { $draft } from "../model/editor";
import { quickCreateFx, quickFocusRequested } from "../model/quick";
import { narrowChanged, sidebarToggled } from "../model/sidebar";
import { $cursor, $now, $today, dateSelected, viewChanged } from "../model/view";
import type { Calendar } from "../shared/api/types";
import { setLang } from "../shared/i18n";
import { formatTime } from "../shared/lib/date";
import { CALENDARS, ME, MINE, WORK, appScope, calendar, renderIn } from "./app-scope.test-utils";
import { Sidebar } from "./Sidebar";
import { SignInActions } from "./SignInActions";

// jsdom has no matchMedia; the panel's model asks it whether the window is narrow when it loads
vi.hoisted(() => {
  window.matchMedia ??= ((media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} })) as never;
});

// Wednesday, November 11, 2026, 12:00; in English the week starts on Sunday
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 11, 12, 0));
  setLang("en");
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setLang("ru");
});

type Setup = {
  accounts?: { email: string; signedIn: boolean }[];
  calendars?: Calendar[];
  values?: [unknown, unknown][];
  handlers?: [unknown, unknown][];
  narrow?: boolean;
  view?: "day" | "week" | "month";
};

const show = async ({ accounts, calendars, values = [], handlers = [], narrow = false, view = "week" }: Setup = {}) => {
  const scope: Scope = await appScope({
    calendars,
    values: [[$now, new Date(2026, 10, 11, 12)], [$today, new Date(2026, 10, 11)], ...values],
    handlers,
  });
  if (accounts) {
    const { $status } = await import("../model/auth");
    await allSettled($status, { scope, params: { clientSource: "build", accounts } });
  }
  await allSettled(viewChanged, { scope, params: view });
  await allSettled(dateSelected, { scope, params: new Date(2026, 10, 11) });
  if (narrow) await allSettled(narrowChanged, { scope, params: true });
  const rendered = renderIn(scope, <Sidebar />);
  return { scope, container: rendered.container };
};

const watch = (scope: Scope, unit: Parameters<typeof createWatch>[0]["unit"]) => {
  const fn = vi.fn();
  createWatch({ unit, scope, fn });
  return fn;
};

const mini = () => screen.getByText("November 2026").closest("section") as HTMLElement;
const day = (n: number) =>
  within(mini())
    .getAllByRole("button", { name: String(n) })
    .find((b) => !b.className.includes("outside")) as HTMLElement;

describe("the panel", () => {
  it("Create opens a new event", async () => {
    const { scope } = await show();
    const create = screen.getByRole("button", { name: /Create/ });
    expect(create.title).toBe("New event");
    fireEvent.click(create);
    expect(scope.getState($draft)).toMatchObject({ title: "", calendarId: MINE });
  });

  it("in a wide window it stands beside the calendar; its button hides it", async () => {
    const { scope, container } = await show();
    const aside = container.querySelector("aside") as HTMLElement;
    expect(aside.className).not.toContain("hidden");
    expect(aside.className).not.toContain("over");
    expect(container.querySelector("[class*=scrim]")).toBeNull();
    await act(() => allSettled(sidebarToggled, { scope }));
    expect(aside.className).toContain("hidden");
  });

  it("in a narrow window it is pulled out over the calendar; Esc or a click beside it closes it", async () => {
    const { scope, container } = await show({ narrow: true });
    const aside = container.querySelector("aside") as HTMLElement;
    expect(aside.className).toContain("hidden");
    await act(() => allSettled(sidebarToggled, { scope }));
    expect(aside.className).toContain("over");
    expect(aside.className).not.toContain("hidden");
    fireEvent.keyDown(window, { key: "Enter" });
    expect(aside.className).not.toContain("hidden");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(aside.className).toContain("hidden");
    await act(() => allSettled(sidebarToggled, { scope }));
    fireEvent.mouseDown(container.querySelector("[class*=scrim]") as HTMLElement);
    expect(aside.className).toContain("hidden");
    expect(container.querySelector("[class*=scrim]")).toBeNull();
  });

  it("Esc does nothing to a panel standing beside the calendar", async () => {
    const { container } = await show();
    fireEvent.keyDown(window, { key: "Escape" });
    expect((container.querySelector("aside") as HTMLElement).className).not.toContain("hidden");
  });
});

describe("the mini month", () => {
  it("shows the month with its weekdays; today and the current week are marked", async () => {
    await show();
    expect(within(mini()).getAllByText(/^[SMTWF]$/)).toHaveLength(7);
    expect(day(11).className).toContain("today");
    expect(day(12).className).not.toContain("today");
    expect(day(8).className).toContain("inRange");
    expect(day(14).className).toContain("inRange");
    expect(day(15).className).not.toContain("inRange");
    expect(day(7).className).not.toContain("inRange");
    const outside = within(mini()).getAllByRole("button", { name: "1" });
    expect(outside.map((b) => b.className.includes("outside"))).toEqual([false, true]);
  });

  it("the month view marks no range", async () => {
    await show({ view: "month" });
    expect(day(11).className).not.toContain("inRange");
  });

  it("a day click goes to it", async () => {
    const { scope } = await show();
    fireEvent.click(day(20));
    expect(scope.getState($cursor)).toEqual(new Date(2026, 10, 20));
  });

  it("pages by itself and catches up when the main view goes to another month", async () => {
    const { scope } = await show();
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByText("December 2026")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByText("October 2026")).toBeTruthy();
    await act(() => allSettled(dateSelected, { scope, params: new Date(2027, 0, 5) }));
    expect(screen.getByText("January 2027")).toBeTruthy();
  });

  it("week numbers in front of each week, when turned on", async () => {
    await show({ values: [[$weekNumbers, true]] });
    const numbers = [...mini().querySelectorAll<HTMLElement>("[class*=weekNo]")];
    expect(numbers.map((n) => n.textContent)).toEqual(["45", "46", "47", "48", "49", "50"]);
    expect(numbers[0].title).toBe("Week 45");
    expect(mini().querySelector("[class*=withWeeks]")).not.toBeNull();
  });

  it("no week numbers when off", async () => {
    await show();
    expect(mini().querySelector("[class*=weekNo]")).toBeNull();
    expect(mini().querySelector("[class*=withWeeks]")).toBeNull();
  });
});

describe("calendars", () => {
  const holiday = calendar(`${ME}\u0000pl#holiday`, { name: "Holidays in Poland", holiday: true, accessRole: "reader", color: "#00ff00" });
  const feed = calendar("feed\u0000f1", { name: "Matches", feed: true, accessRole: "reader" });

  it("each account is a group with its calendars and Sign out; holidays and subscriptions have their own", async () => {
    await show({ accounts: [{ email: ME, signedIn: true }, { email: WORK, signedIn: true }], calendars: [...CALENDARS, holiday, feed] });
    const mine = screen.getByRole("group", { name: ME });
    expect(within(mine).getAllByRole("checkbox").map((c) => c.closest("label")?.title)).toEqual(["Personal", "Team", "Shared"]);
    expect(within(screen.getByRole("group", { name: WORK })).getAllByRole("checkbox")).toHaveLength(1);
    expect(within(screen.getByRole("group", { name: "Holidays" })).getByText("Holidays in Poland")).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "Subscriptions" })).getByText("Matches")).toBeTruthy();
  });

  it("without holidays or subscriptions there are no such groups", async () => {
    await show();
    expect(screen.queryByRole("group", { name: "Holidays" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Subscriptions" })).toBeNull();
  });

  it("a calendar is hidden and shown again by its box; its color follows", async () => {
    const { scope } = await show({ calendars: [calendar(MINE, { name: "Personal", color: "#ff0000" })] });
    const box = screen.getByRole("checkbox") as HTMLInputElement;
    const swatch = box.nextElementSibling as HTMLElement;
    expect(box.checked).toBe(true);
    expect(box.style.accentColor).toBe("rgb(255, 0, 0)");
    expect(swatch.style.backgroundColor).toBe("rgb(255, 0, 0)");
    fireEvent.click(box);
    expect(scope.getState($calendarsWithVisibility)[0].visible).toBe(false);
    expect(box.checked).toBe(false);
    expect(swatch.style.backgroundColor).toBe("transparent");
    expect(swatch.style.borderColor).toBe("rgb(255, 0, 0)");
  });

  it("an account whose sign-in Google no longer accepts offers to sign in again", async () => {
    let finish = () => {};
    const { scope } = await show({
      accounts: [{ email: ME, signedIn: false }],
      handlers: [[signInFx, () => new Promise<string>((r) => (finish = () => r(ME)))]],
    });
    const group = screen.getByRole("group", { name: ME });
    expect(within(group).queryByRole("checkbox")).toBeNull();
    expect(within(group).getByText(/Signed out\./)).toBeTruthy();
    fireEvent.click(within(group).getByRole("button", { name: "Sign in again" }));
    await waitFor(() => expect((within(group).getByRole("button", { name: "Sign in again" }) as HTMLButtonElement).disabled).toBe(true));
    await act(async () => finish());
    expect(scope).toBeTruthy();
  });
});

describe("signing out", () => {
  it("Sign out asks once more; the second click signs that account out", async () => {
    const { scope } = await show();
    const out = watch(scope, signOutClicked);
    const button = screen.getByRole("button", { name: "Sign out" });
    expect(button.title).toBe(`Sign out of ${ME}`);
    fireEvent.click(button);
    expect(button.textContent).toBe("Sign out?");
    expect(button.className).toContain("asking");
    expect(out).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(out).toHaveBeenCalledWith(ME);
  });

  it("the question goes away when the focus leaves, on Esc, or after five seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 11, 12, 0));
    await show();
    const button = screen.getByRole("button", { name: "Sign out" });
    fireEvent.click(button);
    fireEvent.blur(button);
    expect(button.textContent).toBe("Sign out");
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "a" });
    expect(button.textContent).toBe("Sign out?");
    fireEvent.keyDown(button, { key: "Escape" });
    expect(button.textContent).toBe("Sign out");
    fireEvent.click(button);
    act(() => void vi.advanceTimersByTime(4999));
    expect(button.textContent).toBe("Sign out?");
    act(() => void vi.advanceTimersByTime(1));
    expect(button.textContent).toBe("Sign out");
    expect(button.className).not.toContain("asking");
  });
});

describe("adding an account", () => {
  it("Add account signs in; while waiting it says where to finish and offers a way out", async () => {
    let finish = () => {};
    const { scope } = await show({ handlers: [[signInFx, () => new Promise<string>((r) => (finish = () => r(ME)))]] });
    const reopen = watch(scope, signInReopenClicked);
    const cancel = watch(scope, signInCancelClicked);
    expect(screen.queryByRole("button", { name: "Open the sign-in page again" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Add account/ }));
    const waiting = await screen.findByRole("button", { name: /Finish signing in in your browser/ });
    expect((waiting as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Open the sign-in page again" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(reopen).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(screen.getByRole("button", { name: /Add account/ })).toBeTruthy();
  });

  it("a sign-in error and the time of the last update are shown", async () => {
    // the events loaded with the panel's scope are the last update: now
    await show({ values: [[$authError, "Sign-in timed out"]] });
    expect(screen.getByText("Sign-in timed out")).toBeTruthy();
    expect(screen.getByText(`Updated ${formatTime(new Date(2026, 10, 11, 12))}`)).toBeTruthy();
  });

  it("no error, no error line", async () => {
    const { container } = await show();
    expect(container.querySelector("[class*=error]")).toBeNull();
  });
});

describe("quick add in the panel", () => {
  it("creates in the first writable calendar; Ctrl+Enter opens the form", async () => {
    const created = vi.fn(async () => {});
    const { scope } = await show({ handlers: [[quickCreateFx, created]] });
    const line = screen.getByRole("textbox", { name: "Quick add an event" });
    fireEvent.change(line, { target: { value: "tomorrow 7pm gym" } });
    fireEvent.keyDown(line, { key: "Enter" });
    await waitFor(() => expect(created).toHaveBeenCalledWith(expect.objectContaining({ calendarId: MINE, title: "Gym" })));
    fireEvent.change(line, { target: { value: "tomorrow 8pm swim" } });
    fireEvent.keyDown(line, { key: "Enter", ctrlKey: true });
    expect(scope.getState($draft)).toMatchObject({ title: "Swim", startTime: "20:00" });
  });

  it("a failed save shows why", async () => {
    await show({ handlers: [[quickCreateFx, async () => Promise.reject({ kind: "network", message: "No internet" })]] });
    const line = screen.getByRole("textbox", { name: "Quick add an event" });
    fireEvent.change(line, { target: { value: "tomorrow 7pm gym" } });
    fireEvent.keyDown(line, { key: "Enter" });
    expect(await screen.findByText("No internet")).toBeTruthy();
  });

  it("asked from elsewhere, the line takes the focus on the next frame", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((fn) => (fn(0), 0));
    await show();
    act(() => quickFocusRequested());
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Quick add an event" }));
  });

  it("once the panel is gone it no longer takes the focus", async () => {
    const frame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((fn) => (fn(0), 0));
    await show();
    cleanup();
    act(() => quickFocusRequested());
    expect(frame).not.toHaveBeenCalled();
  });
});

describe("small parts", () => {
  it("with week numbers the weekday row has a blank first cell", async () => {
    await show({ values: [[$weekNumbers, true]] });
    expect(mini().querySelectorAll("[class*=miniWeekday]")).toHaveLength(8);
    cleanup();
    await show();
    expect(mini().querySelectorAll("[class*=miniWeekday]")).toHaveLength(7);
  });

  it("the sign-in way out can stand in the middle", () => {
    const { container, rerender } = render(<SignInActions />);
    expect((container.firstElementChild as HTMLElement).className).not.toContain("center");
    rerender(<SignInActions center />);
    expect((container.firstElementChild as HTMLElement).className).toMatch(/row\S* \S*center/);
  });
});
