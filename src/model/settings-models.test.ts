// Search, view, display settings and sign-in: request handlers, stored settings and what each event changes
import { allSettled, fork, scopeBind } from "effector";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as bridge from "../shared/api/bridge";
import { broadcast } from "../shared/api/bus";
import * as api from "../shared/api/calendar";
import type { Calendar, CalendarEvent } from "../shared/api/types";
import { t } from "../shared/i18n";
import {
  $accounts,
  $authError,
  $editingClient,
  cancelSignInFx,
  clientEditCancelled,
  clientEditRequested,
  clientSubmitted,
  fetchStatusFx,
  reopenSignInFx,
  saveClientFx,
  signInClicked,
  signInFx,
  signOutFx,
} from "./auth";
import { $query, $results, $searchProblem, queryChanged, searchClosed, searchFx, searchRequested } from "./search";

vi.mock("../shared/api/calendar", async (original) => ({
  ...(await original<typeof import("../shared/api/calendar")>()),
  searchEvents: vi.fn(),
}));
vi.mock("../shared/api/bridge", async (original) => ({
  ...(await original<typeof import("../shared/api/bridge")>()),
  signIn: vi.fn(async () => "me@x"),
  reopenSignIn: vi.fn(async () => undefined),
  cancelSignIn: vi.fn(async () => undefined),
  signOut: vi.fn(async () => undefined),
  saveClientConfig: vi.fn(async () => undefined),
}));
vi.mock("../shared/api/bus", async (original) => ({ ...(await original<typeof import("../shared/api/bus")>()), broadcast: vi.fn() }));
afterEach(() => vi.clearAllMocks());

const cal = (id: string): Calendar => ({ id, name: id } as Calendar);
const found = (id: string): CalendarEvent => ({
  key: id, id, calendarId: "c", account: "me@x", title: id, start: new Date(2026, 10, 4, 9), end: new Date(2026, 10, 4, 10), allDay: false, recurring: false,
});

describe("search request", () => {
  const searchEvents = vi.mocked(api.searchEvents);

  it("names calendars that didn't answer and returns at most 40 results", async () => {
    searchEvents.mockImplementation(async (id) => {
      if (id === "work") throw { kind: "network", message: "offline" };
      return Array.from({ length: 45 }, (_, i) => found(`e${i}`));
    });
    const { value } = await allSettled(searchFx, { scope: fork(), params: { query: "e", calendars: [cal("me"), cal("work")], id: 3 } });
    expect(value).toMatchObject({ id: 3, failed: ["work"] });
    expect((value as { results: unknown[] }).results).toHaveLength(40);
  });

  it("nothing answering is a failure with the first error", async () => {
    searchEvents.mockRejectedValueOnce(new Error("first")).mockRejectedValueOnce(new Error("second"));
    const result = await allSettled(searchFx, { scope: fork(), params: { query: "e", calendars: [cal("a"), cal("b")], id: 1 } });
    expect(result).toEqual({ status: "fail", value: { kind: "other", message: "first" } });
  });
});

describe("search results", () => {
  const scopeWith = (handler: (p: { query: string; id: number }) => unknown) => fork({ handlers: [[searchFx, handler]] });
  const search = async (scope: ReturnType<typeof fork>, query: string) => {
    await allSettled(queryChanged, { scope, params: query });
    await allSettled(searchRequested, { scope });
  };

  it("a query of two letters is searched, one letter is not; spaces around don't matter", async () => {
    const handler = vi.fn(async ({ id }: { id: number }) => ({ id, results: [found("a")], failed: [] }));
    const scope = scopeWith(handler);
    await search(scope, " a ");
    expect(handler).not.toHaveBeenCalled();
    await search(scope, "  ab  ");
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ query: "ab" }));
    expect(scope.getState($results)?.map((e) => e.id)).toEqual(["a"]);
  });

  it("calendars that didn't answer are named, a failed search says why", async () => {
    const scope = scopeWith(async ({ id, query }) => (query === "ok" ? { id, results: [], failed: ["Work", "Home"] } : Promise.reject({ kind: "network", message: "Offline" })));
    await search(scope, "ok");
    expect(scope.getState($searchProblem)).toBe(t.search.partial("Work, Home"));
    await search(scope, "no");
    expect(scope.getState($searchProblem)).toBe(t.search.failed("Offline"));
  });

  it("an older search answering late, done or failed, doesn't replace the latest", async () => {
    const waiting = new Map<string, { ok: () => void; no: () => void }>();
    const scope = scopeWith(({ id, query }) => new Promise((ok, no) => waiting.set(query, {
      ok: () => ok({ id, results: [found(query)], failed: [] }),
      no: () => no({ kind: "network", message: "late" }),
    })));
    const start = (query: string) => {
      scopeBind(queryChanged, { scope })(query);
      scopeBind(searchRequested, { scope })();
    };
    start("old");
    start("bad");
    start("new");
    waiting.get("new")?.ok();
    waiting.get("old")?.ok();
    waiting.get("bad")?.no();
    await allSettled(scope);
    expect(scope.getState($results)?.map((e) => e.id)).toEqual(["new"]);
    expect(scope.getState($searchProblem)).toBeNull();
  });

  it("closing the search or signing out clears it", async () => {
    const scope = fork({ handlers: [[searchFx, async ({ id }: { id: number }) => ({ id, results: [found("a")], failed: [] })], [signOutFx, async () => undefined], [fetchStatusFx, async () => ({ clientSource: "file", accounts: [] })]] });
    await search(scope, "ab");
    await allSettled(searchClosed, { scope });
    expect([scope.getState($query), scope.getState($results)]).toEqual(["", null]);
    await allSettled(queryChanged, { scope, params: "ab" });
    expect(scope.getState($results)).toBeNull();
    await search(scope, "ab");
    await allSettled(signOutFx, { scope, params: undefined });
    expect([scope.getState($query), scope.getState($results)]).toEqual(["", null]);
  });
});

describe("stored view and display settings", () => {
  let stored: Map<string, string>;
  beforeEach(() => {
    stored = new Map();
    vi.stubGlobal("localStorage", { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v) });
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  const store = (items: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(items)) stored.set(k, JSON.stringify(v));
  };
  const freshView = (items: Record<string, unknown> = {}) => (store(items), import("./view"));
  const freshDisplay = (items: Record<string, unknown> = {}) => (store(items), import("./display"));

  it("the stored view is restored, an unknown one falls back to the week", async () => {
    for (const view of ["month", "week", "day", "agenda"]) {
      vi.resetModules();
      const m = await freshView({ "calm.view": view });
      expect(fork().getState(m.$view)).toBe(view);
    }
    vi.resetModules();
    const m = await freshView({ "calm.view": "year" });
    expect(fork().getState(m.$view)).toBe("week");
  });

  it("opening a day shows it in the day view, Today goes back to today, arrows page by the view, the view is remembered", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 4, 12));
    const m = await freshView();
    const scope = fork();
    await allSettled(m.dayOpened, { scope, params: new Date(2026, 10, 20) });
    expect(scope.getState(m.$view)).toBe("day");
    expect(scope.getState(m.$cursor)).toEqual(new Date(2026, 10, 20));
    await allSettled(m.prevClicked, { scope });
    expect(scope.getState(m.$cursor)).toEqual(new Date(2026, 10, 19));
    await allSettled(m.nextClicked, { scope });
    await allSettled(m.nextClicked, { scope });
    expect(scope.getState(m.$cursor)).toEqual(new Date(2026, 10, 21));
    await allSettled(m.todayClicked, { scope });
    expect(scope.getState(m.$cursor)).toEqual(new Date(2026, 10, 4));
    await allSettled(m.viewChanged, { scope, params: "month" });
    expect(stored.get("calm.view")).toBe(JSON.stringify("month"));
  });

  it("week numbers are on only when stored as true", async () => {
    for (const [value, on] of [[true, true], ["true", false], [undefined, false]] as const) {
      vi.resetModules();
      const m = await freshDisplay(value === undefined ? {} : { "calm.weekNumbers": value });
      expect(fork().getState(m.$weekNumbers)).toBe(on);
    }
  });

  it("display settings are saved and the other windows told", async () => {
    const m = await freshDisplay();
    const scope = fork();
    await allSettled(m.weekNumbersToggled, { scope, params: true });
    expect(stored.get("calm.weekNumbers")).toBe("true");
    await allSettled(m.feedAdded, { scope, params: { url: "https://a.example/x.ics", name: "A" } });
    await allSettled(m.feedAdded, { scope, params: { url: "https://b.example/x.ics", name: "B" } });
    const [a] = scope.getState(m.$feeds);
    await allSettled(m.feedRemoved, { scope, params: a.id });
    expect(scope.getState(m.$feeds).map((f) => f.name)).toEqual(["B"]);
    expect(JSON.parse(stored.get("calm.feeds") ?? "[]").map((f: { name: string }) => f.name)).toEqual(["B"]);
    await allSettled(m.holidayRegionChanged, { scope, params: "nowhere" });
    await allSettled(m.holidayRegionChanged, { scope, params: "PL" });
    expect(stored.get("calm.holidays")).toBe(JSON.stringify("PL"));
    await allSettled(m.feedsChanged, { scope, params: [{ broken: true }] as never });
    expect(scope.getState(m.$feeds)).toEqual([]);
    expect(vi.mocked(broadcast).mock.calls).toEqual(Array(5).fill(["events-changed", { from: "main" }]));
  });

  it("settings changed in another window are read again", async () => {
    const m = await freshDisplay();
    stored.set("calm.weekNumbers", "true");
    stored.set("calm.holidays", JSON.stringify("PL"));
    stored.set("calm.feeds", JSON.stringify([{ id: "f", url: "https://a.example", name: "A", color: "#000000" }]));
    m.displayReloaded();
    expect([m.$weekNumbers.getState(), m.$holidayRegion.getState(), m.$feeds.getState().map((f) => f.id)]).toEqual([true, "PL", ["f"]]);
    stored.set("calm.weekNumbers", "false");
    m.displayReloaded();
    expect(m.$weekNumbers.getState()).toBe(false);
  });
});

describe("sign-in", () => {
  it("the sign-in requests go to the app", async () => {
    const scope = fork({ handlers: [[fetchStatusFx, async () => ({ clientSource: "file", accounts: [] })]] });
    await allSettled(signInFx, { scope });
    await allSettled(reopenSignInFx, { scope });
    await allSettled(cancelSignInFx, { scope });
    await allSettled(signOutFx, { scope, params: "" });
    await allSettled(saveClientFx, { scope, params: { clientId: "id", clientSecret: "secret" } });
    expect([bridge.signIn, bridge.reopenSignIn, bridge.cancelSignIn].map((f) => vi.mocked(f).mock.calls.length)).toEqual([1, 1, 1]);
    expect(vi.mocked(bridge.signOut)).toHaveBeenCalledWith(undefined);
    expect(vi.mocked(bridge.saveClientConfig)).toHaveBeenCalledWith("id", "secret");
  });

  it("without an OAuth client there are no accounts", async () => {
    const scope = fork({ handlers: [[fetchStatusFx, async () => ({ clientSource: "none", accounts: [{ email: "me@x", signedIn: true }] })]] });
    expect(scope.getState($accounts)).toEqual([]);
    await allSettled(fetchStatusFx, { scope });
    expect(scope.getState($accounts)).toEqual([]);
  });

  it("editing the client: on, then off when cancelled or saved; a save error shows until the next try", async () => {
    let fail = true;
    const status = vi.fn(async () => ({ clientSource: "file" as const, accounts: [] }));
    const scope = fork({ handlers: [[saveClientFx, async () => (fail ? Promise.reject({ kind: "other", message: "Bad file" }) : undefined)], [fetchStatusFx, status]] });
    await allSettled(clientEditRequested, { scope });
    expect(scope.getState($editingClient)).toBe(true);
    await allSettled(clientEditCancelled, { scope });
    expect(scope.getState($editingClient)).toBe(false);
    await allSettled(clientEditRequested, { scope });
    await allSettled(clientSubmitted, { scope, params: { clientId: "id", clientSecret: "s" } });
    expect(scope.getState($authError)).toBe("Bad file");
    fail = false;
    await allSettled(clientSubmitted, { scope, params: { clientId: "id", clientSecret: "s" } });
    expect([scope.getState($authError), scope.getState($editingClient)]).toEqual([null, false]);
    expect(status).toHaveBeenCalledTimes(1);
  });

  it("a second click while signing in does nothing; sign-in and sign-out re-read the status and tell the other windows", async () => {
    let finish!: () => void;
    const signIn = vi.fn(() => new Promise<string>((done) => (finish = () => done("me@x"))));
    const status = vi.fn(async () => ({ clientSource: "file" as const, accounts: [] }));
    const scope = fork({ handlers: [[signInFx, signIn], [fetchStatusFx, status], [signOutFx, async () => undefined]] });
    const first = allSettled(signInClicked, { scope });
    const second = allSettled(signInClicked, { scope });
    finish();
    await Promise.all([first, second]);
    expect(signIn).toHaveBeenCalledTimes(1);
    await allSettled(signOutFx, { scope, params: undefined });
    expect(status).toHaveBeenCalledTimes(2);
    expect(vi.mocked(broadcast).mock.calls).toEqual([["auth-changed"], ["auth-changed"]]);
  });

});
