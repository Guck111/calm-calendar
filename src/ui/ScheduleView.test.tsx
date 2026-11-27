// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { allSettled, fork, type Scope } from "effector";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { $opened } from "../model/editor";
import { $ratingState, checkStoreFx, rateClicked, rateDeclined } from "../model/rating";
import { $welcomeOpen } from "../model/welcome";
import { $cursor, $now, $today, $view, dateSelected, viewChanged } from "../model/view";
import type { CalendarEvent } from "../shared/api/types";
import { setLang } from "../shared/i18n";
import { formatTime } from "../shared/lib/date";
import { ME, WORK, WORK_CAL, appScope, event, renderIn } from "./app-scope.test-utils";
import { Button } from "./Button";
import { RateCard } from "./RateCard";
import { ScheduleView } from "./ScheduleView";

const mocks = vi.hoisted(() => ({ openExternal: vi.fn(async (_url: string) => {}) }));
vi.mock("../shared/api/open", () => ({ openExternal: mocks.openExternal }));

// Wednesday, November 11, 2026, 12:00; the schedule shows four weeks from the cursor
const NOW = new Date(2026, 10, 11, 12, 0);
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m);

beforeEach(() => setLang("en"));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setLang("ru");
});

const show = async (events: CalendarEvent[], accounts?: string[]) => {
  const scope: Scope = await appScope({ events, accounts, values: [[$now, NOW], [$today, at(11, 0)]] });
  await allSettled(viewChanged, { scope, params: "agenda" });
  await allSettled(dateSelected, { scope, params: at(11, 0) });
  const view = renderIn(scope, <ScheduleView />);
  return { scope, container: view.container };
};

const day = (label: RegExp) => screen.getByRole("button", { name: label }).closest("section") as HTMLElement;

describe("schedule", () => {
  it("no events: says so", async () => {
    await show([]);
    expect(screen.getByText("No events on these days")).toBeTruthy();
  });

  it("only days with events, each under its date; today is marked; a date opens its day", async () => {
    const { scope } = await show([
      event({ key: "a", id: "a", title: "Dentist", start: at(11, 16), end: at(11, 17) }),
      event({ key: "b", id: "b", title: "Gym", start: at(13, 18), end: at(13, 19) }),
    ]);
    expect(screen.queryByText("No events on these days")).toBeNull();
    const dates = screen.getAllByRole("button", { name: /November/ });
    expect(dates.map((d) => d.textContent)).toEqual(["Wed, November 11", "Fri, November 13"]);
    expect(dates[0].title).toBe("Open day");
    expect(day(/November 11/).className).toContain("today");
    expect(day(/November 13/).className).not.toContain("today");
    fireEvent.click(dates[1]);
    expect(scope.getState($view)).toBe("day");
    expect(scope.getState($cursor)).toEqual(at(13, 0));
  });

  it("a row shows the time or all day, the title, the place; ended ones are dimmed; a click opens it", async () => {
    const { scope } = await show([
      event({ key: "p", id: "p", title: "Standup", start: at(11, 9), end: at(11, 9, 30), recurring: true, location: "https://meet.google.com/abc" }),
      event({ key: "h", id: "h", title: "Holiday", allDay: true, start: at(12, 0), end: at(13, 0) }),
      event({ key: "d", id: "d", title: "Dentist", start: at(11, 16), end: at(11, 17), location: "Gdynia, Świętojańska 1" }),
    ]);
    const standup = screen.getByRole("button", { name: /Standup/ });
    expect(standup.textContent).toBe(`${formatTime(at(11, 9))}–${formatTime(at(11, 9, 30))}Standupmeet.google.com`);
    expect(standup.className).toContain("past");
    expect(standup.querySelector("svg")).not.toBeNull();
    expect(screen.getByTitle("https://meet.google.com/abc").textContent).toBe("meet.google.com");
    expect(screen.getByRole("button", { name: /Holiday/ }).textContent).toBe("all dayHoliday");
    const dentist = screen.getByRole("button", { name: /Dentist/ });
    expect(dentist.className).not.toContain("past");
    expect(dentist.querySelector("svg")).toBeNull();
    expect(dentist.getAttribute("data-event-key")).toBe("d");
    fireEvent.click(dentist);
    expect(scope.getState($opened)?.key).toBe("d");
  });

  it("an overlap with another account is marked and named", async () => {
    await show(
      [
        event({ key: "a", id: "a", title: "Dentist", start: at(11, 16), end: at(11, 17) }),
        event({ key: "w", id: "w", title: "Call", calendarId: WORK_CAL, account: WORK, start: at(11, 16), end: at(11, 17) }),
      ],
      [ME, WORK],
    );
    const mark = within(document.querySelector('[data-event-key="a"]') as HTMLElement).getByRole("img");
    expect(mark.getAttribute("aria-label")).toBe("Overlaps with: Call");
    expect(mark.title).toBe("Overlaps with: Call");
  });

  it("Join appears from 15 minutes before a call until its end", async () => {
    const meeting = { provider: "Google Meet", url: "https://meet.google.com/x" } as CalendarEvent["meeting"];
    await show([
      event({ key: "soon", id: "soon", title: "Soon", start: at(11, 12, 10), end: at(11, 13), meeting }),
      event({ key: "later", id: "later", title: "Later", start: at(11, 15), end: at(11, 16), meeting }),
    ]);
    const join = screen.getByRole("button", { name: "Join" });
    expect(join.title).toBe("Join with Google Meet");
    expect(screen.getAllByRole("button", { name: "Join" })).toHaveLength(1);
    fireEvent.click(join);
    expect(mocks.openExternal).toHaveBeenCalledWith("https://meet.google.com/x");
  });

  it("each page starts from the top", async () => {
    const { scope, container } = await show([event()]);
    const list = container.firstElementChild as HTMLElement;
    list.scrollTop = 300;
    await act(() => allSettled(dateSelected, { scope, params: at(25, 0) }));
    expect(list.scrollTop).toBe(0);
  });
});

describe("rating card", () => {
  // two weeks of use in the Store build, the feature card closed
  const due = async (storeBuild: boolean) => {
    const scope = fork({
      values: [[$ratingState, { since: "2026-10-01", answered: false }], [$welcomeOpen, false], [$today, NOW]] as never,
      handlers: [[checkStoreFx, async () => storeBuild]] as never,
    });
    await allSettled(checkStoreFx, { scope });
    return scope;
  };

  it("outside the Store build: nothing", async () => {
    const view = renderIn(await due(false), <RateCard />);
    expect(view.container.innerHTML).toBe("");
  });

  it("asks once in the corner; Rate, Not now and the cross answer it", async () => {
    const answers: string[] = [];
    rateClicked.watch(() => answers.push("rate"));
    rateDeclined.watch(() => answers.push("later"));
    for (const name of ["Rate in Store", "Not now", "Close"]) {
      renderIn(await due(true), <RateCard />);
      expect(screen.getByRole("complementary", { name: "Enjoying Calm Calendar?" })).toBeTruthy();
      expect(screen.getByText(/A rating in Microsoft Store/)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name }));
      // answered: it doesn't ask again
      expect(screen.queryByRole("complementary")).toBeNull();
      cleanup();
    }
    expect(answers).toEqual(["rate", "later", "later"]);
  });
});

describe("button", () => {
  it("a plain button by default, never submitting a form by accident", () => {
    render(<Button>Go</Button>);
    const b = screen.getByRole("button", { name: "Go" }) as HTMLButtonElement;
    expect(b.type).toBe("button");
    expect(b.className).toMatch(/^_button_\S+$/);
  });

  it("primary, ghost, danger and icon looks, an extra class, any other attribute", () => {
    render(
      <>
        <Button variant="primary" type="submit">
          A
        </Button>
        <Button variant="ghost" danger icon className="mine" title="hint">
          B
        </Button>
      </>,
    );
    const a = screen.getByRole("button", { name: "A" }) as HTMLButtonElement;
    const b = screen.getByRole("button", { name: "B" });
    expect(a.type).toBe("submit");
    expect(a.className).toContain("primary");
    expect(a.className).not.toMatch(/ghost|danger|icon/);
    expect(b.className).toMatch(/ghost/);
    expect(b.className).toMatch(/danger/);
    expect(b.className).toMatch(/icon/);
    expect(b.className).toMatch(/ mine$/);
    expect(b.className).not.toContain("primary");
    expect(b.title).toBe("hint");
  });
});

describe("schedule edges", () => {
  it("an event ending right now counts as over", async () => {
    await show([event({ key: "e", id: "e", title: "Ended", start: at(11, 11), end: NOW })]);
    expect(screen.getByRole("button", { name: /Ended/ }).className).toContain("past");
  });
});
