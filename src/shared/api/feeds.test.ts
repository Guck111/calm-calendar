import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import { FEED_ACCOUNT, FEEDS_KEY } from "../lib/feeds";
import { calendarRef } from "./calendar";
import { downloadFeed, dropFeedCache, forgetFeeds, isCalendarText, listFeedEvents, searchFeedEvents } from "./feeds";

const fetchFeed = vi.hoisted(() => vi.fn());
vi.mock("./bridge", async (original) => ({ ...(await original<typeof import("./bridge")>()), fetchFeed }));

const URL = "https://example.com/team.ics";
const FEED_ID = "f1";
const CALENDAR = calendarRef(FEED_ACCOUNT, FEED_ID);
const SAVED = `calm.feedCache.${FEED_ID}`;
const range = { start: new Date(Date.UTC(2026, 10, 1)), end: new Date(Date.UTC(2026, 11, 1)) };

const vevent = (uid: string, summary: string, day: number, extra: string[] = []) => [
  "BEGIN:VEVENT",
  `UID:${uid}`,
  `SUMMARY:${summary}`,
  `DTSTART:202611${String(day).padStart(2, "0")}T090000Z`,
  `DTEND:202611${String(day).padStart(2, "0")}T100000Z`,
  ...extra,
  "END:VEVENT",
];
const ics = (...events: string[][]) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...events.flat(), "END:VCALENDAR"].join("\r\n");
const YOGA = ics(vevent("yoga", "Йога", 4, ["LOCATION:Зал на Ленина"]), vevent("match", "Матч", 7, ["DESCRIPTION:Финал кубка"]));

let stored: Map<string, string>;
const newStorage = () => ({
  getItem: vi.fn((k: string) => stored.get(k) ?? null),
  setItem: vi.fn((k: string, v: string) => void stored.set(k, v)),
  removeItem: vi.fn((k: string) => void stored.delete(k)),
});
let storage = newStorage();

const subscribe = (url = URL) => stored.set(FEEDS_KEY, JSON.stringify([{ id: FEED_ID, url, name: "Team", color: "#8e63ce" }]));
const titles = async () => (await listFeedEvents(CALENDAR, range)).map((e) => e.title);
const offline = { kind: "network", message: "offline" };

beforeEach(() => {
  stored = new Map();
  storage = newStorage();
  vi.stubGlobal("localStorage", storage);
  fetchFeed.mockReset();
  forgetFeeds();
  subscribe();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("downloading a subscription", () => {
  it("a calendar file is recognized in any letter case, a web page is not", () => {
    expect(isCalendarText("begin:vcalendar\r\nend:vcalendar")).toBe(true);
    expect(isCalendarText("<html>BEGIN:VEVENT</html>")).toBe(false);
  });

  it("a link to a web page gives a clear error", async () => {
    fetchFeed.mockResolvedValueOnce("<html></html>");
    await expect(downloadFeed(URL)).rejects.toEqual({ kind: "other", message: t.settings.feedNotIcs });
    fetchFeed.mockResolvedValueOnce(YOGA);
    expect((await downloadFeed(URL)).events.map((e) => e.summary)).toEqual(["Йога", "Матч"]);
  });
});

describe("subscription events", () => {
  it("come from the file by the subscription's link, in the subscription calendar", async () => {
    fetchFeed.mockResolvedValue(YOGA);
    const events = await listFeedEvents(CALENDAR, range);
    expect(fetchFeed).toHaveBeenCalledWith(URL);
    expect(events.map((e) => [e.title, e.calendarId, e.account])).toEqual([
      ["Йога", CALENDAR, FEED_ACCOUNT],
      ["Матч", CALENDAR, FEED_ACCOUNT],
    ]);
  });

  it("a deleted subscription has no events and nothing is downloaded", async () => {
    stored.set(FEEDS_KEY, "[]");
    expect(await listFeedEvents(CALENDAR, range)).toEqual([]);
    expect(fetchFeed).not.toHaveBeenCalled();
  });

  it("the file is downloaded again after 10 minutes, after a refresh or when the link changes", async () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 4, 9), toFake: ["Date"] });
    fetchFeed.mockResolvedValue(YOGA);
    await titles();
    vi.advanceTimersByTime(10 * 60_000 - 1);
    await titles();
    expect(fetchFeed).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await titles();
    expect(fetchFeed).toHaveBeenCalledTimes(2);

    forgetFeeds();
    await titles();
    expect(fetchFeed).toHaveBeenCalledTimes(3);

    subscribe("https://example.com/other.ics");
    await titles();
    expect(fetchFeed).toHaveBeenLastCalledWith("https://example.com/other.ics");
    expect(fetchFeed).toHaveBeenCalledTimes(4);
  });

  it("without network the last downloaded file is shown and kept for a while", async () => {
    fetchFeed.mockResolvedValueOnce(YOGA);
    await titles();
    forgetFeeds();
    fetchFeed.mockRejectedValue(offline);
    expect(await titles()).toEqual(["Йога", "Матч"]);
    expect(await titles()).toEqual(["Йога", "Матч"]);
    expect(fetchFeed).toHaveBeenCalledTimes(2);
  });

  it("without network and without a saved file the error passes through", async () => {
    fetchFeed.mockRejectedValue(offline);
    await expect(titles()).rejects.toEqual(offline);
    storage.getItem.mockImplementation((k) => {
      if (k === SAVED) throw new Error("storage disabled");
      return stored.get(k) ?? null;
    });
    await expect(titles()).rejects.toEqual(offline);
  });

  it("a web page at the link falls back to the saved file, without one it is a clear error", async () => {
    fetchFeed.mockResolvedValueOnce(YOGA);
    await titles();
    forgetFeeds();
    fetchFeed.mockResolvedValueOnce("<html></html>");
    expect(await titles()).toEqual(["Йога", "Матч"]);
    stored.delete(SAVED);
    forgetFeeds();
    fetchFeed.mockResolvedValueOnce("<html></html>");
    await expect(titles()).rejects.toEqual({ kind: "other", message: t.settings.feedNotIcs });
  });

  it("a file too large for storage is shown but not saved; a full storage doesn't break loading", async () => {
    const padding = (size: number) => `X-PAD:${"x".repeat(size)}`;
    const atLimit = ics(vevent("yoga", "Йога", 4), [padding(0)]);
    const exact = atLimit.replace("X-PAD:", `X-PAD:${"x".repeat(1_500_000 - atLimit.length)}`);
    fetchFeed.mockResolvedValueOnce(exact);
    await titles();
    expect(stored.get(SAVED)).toHaveLength(1_500_000);

    stored.delete(SAVED);
    forgetFeeds();
    fetchFeed.mockResolvedValueOnce(exact + "x");
    expect(await titles()).toEqual(["Йога"]);
    expect(stored.has(SAVED)).toBe(false);

    forgetFeeds();
    storage.setItem.mockImplementationOnce(() => {
      throw new Error("quota exceeded");
    });
    fetchFeed.mockResolvedValueOnce(YOGA);
    expect(await titles()).toEqual(["Йога", "Матч"]);
  });

  it("a removed subscription forgets its file in memory and in storage", async () => {
    fetchFeed.mockResolvedValueOnce(YOGA);
    await titles();
    dropFeedCache(FEED_ID);
    expect(stored.has(SAVED)).toBe(false);
    fetchFeed.mockRejectedValueOnce(offline);
    await expect(titles()).rejects.toEqual(offline);

    storage.removeItem.mockImplementationOnce(() => {
      throw new Error("storage disabled");
    });
    expect(() => dropFeedCache(FEED_ID)).not.toThrow();
  });
});

describe("subscription search", () => {
  it("finds the words in title, location and description in any letter case", async () => {
    fetchFeed.mockResolvedValue(YOGA);
    const found = async (query: string, limit = 50) => (await searchFeedEvents(CALENDAR, query, range, limit)).map((e) => e.title);
    expect(await found("  ЙОГ ")).toEqual(["Йога"]);
    expect(await found("ленина")).toEqual(["Йога"]);
    expect(await found("кубка")).toEqual(["Матч"]);
    expect(await found("а", 1)).toEqual(["Йога"]);
    expect(await found("бассейн")).toEqual([]);
  });

  it("an empty query finds nothing and downloads nothing", async () => {
    expect(await searchFeedEvents(CALENDAR, "   ", range, 50)).toEqual([]);
    expect(fetchFeed).not.toHaveBeenCalled();
  });
});
