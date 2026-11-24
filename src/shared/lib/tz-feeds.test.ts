import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "../i18n";
import {
  FEEDS_KEY,
  FEED_ACCOUNT,
  FEED_COLORS,
  feedCalendar,
  feedNameFromUrl,
  looksLikeUrl,
  newFeed,
  parseFeeds,
  sameFeedUrl,
  type Feed,
} from "./feeds";
import { fromZoned, zoneLabel } from "./tz";

afterEach(() => setLang("ru"));

describe("time zones", () => {
  const noon = new Date(Date.UTC(2026, 10, 4, 12));

  it("a date that can't be read is an invalid instant, not an error", () => {
    expect(fromZoned("bad", "09:00", "Europe/Warsaw").getTime()).toBeNaN();
  });

  it("list labels: the zone name in the UI language with the city, only the city when the name is just an offset", () => {
    expect(zoneLabel("Europe/Moscow", noon)).toBe("(GMT+03:00) Москва, стандартное время — Moscow");
    expect(zoneLabel("Asia/Tokyo", noon)).toBe("(GMT+09:00) Япония, стандартное время — Tokyo");
    expect(zoneLabel("Etc/GMT-3", noon)).toBe("(GMT+03:00) GMT-3");
    expect(zoneLabel("UTC", noon)).toBe("(GMT) UTC");
    setLang("en", "en-GB");
    expect(zoneLabel("Europe/Moscow", noon)).toBe("(GMT+03:00) Moscow Standard Time — Moscow");
  });
});

describe("subscriptions by link", () => {
  const feed: Feed = { id: "f1", url: "https://example.com/a.ics", name: "Team", color: "#8e63ce" };

  it("the stored list keeps its key and its calendars their account name", () => {
    expect([FEEDS_KEY, FEED_ACCOUNT]).toEqual(["calm.feeds", "ics"]);
  });

  it("six different colors to rotate", () => {
    expect(FEED_COLORS).toHaveLength(6);
    expect(new Set(FEED_COLORS).size).toBe(6);
    expect(FEED_COLORS.every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true);
  });

  it("only complete entries are read back from storage", () => {
    expect(parseFeeds("nope")).toEqual([]);
    expect(parseFeeds([
      feed, null, { ...feed, id: 1 }, { ...feed, url: undefined }, { ...feed, name: 2 }, { ...feed, color: null },
    ])).toEqual([feed]);
  });

  it("webcal and https, case, spaces and trailing slashes don't make another subscription", () => {
    expect(sameFeedUrl(" webcal://Example.com/cal/ ", "https://example.com/cal")).toBe(true);
    expect(sameFeedUrl("https://example.com/cal//", "https://example.com/cal")).toBe(true);
    expect(sameFeedUrl("https://example.com/a", "https://example.com/b")).toBe(false);
  });

  it("the default name is the site, or the link itself when it has no site", () => {
    expect(feedNameFromUrl(" webcal://calendar.example.com/x.ics")).toBe("calendar.example.com");
    expect(feedNameFromUrl("not a link")).toBe("not a link");
    expect(feedNameFromUrl("file:///home/cal.ics")).toBe("file:///home/cal.ics");
  });

  it("a link must have a scheme we download and a dotted host", () => {
    expect(["https://a.b/c", " http://a.b ", "webcal://cal.example.com/x.ics"].map(looksLikeUrl)).toEqual([true, true, true]);
    expect(["ftp://a.b/c", "https://localhost/x", "https://a.b c", "xhttps://a.b"].map(looksLikeUrl)).toEqual([false, false, false, false]);
  });

  it("a new subscription is trimmed, named and colored in rotation", () => {
    expect(newFeed(" https://cal.example.com/x.ics ", "  ", [], "id1")).toEqual({
      id: "id1", url: "https://cal.example.com/x.ics", name: "cal.example.com", color: FEED_COLORS[0],
    });
    expect(newFeed("https://a.b", " Mine ", [feed], "id2")).toMatchObject({ name: "Mine", color: FEED_COLORS[1] });
    expect(newFeed("https://a.b", "x", Array(FEED_COLORS.length).fill(feed), "id3").color).toBe(FEED_COLORS[0]);
  });

  it("a subscription is a read-only calendar of its own", () => {
    expect(feedCalendar(feed)).toEqual({
      id: "ics\u0000f1",
      googleId: "f1",
      account: "ics",
      name: "Team",
      color: "#8e63ce",
      textColor: "#000000",
      accessRole: "reader",
      primary: false,
      selected: true,
      defaultReminders: [],
      feed: true,
    });
  });
});
