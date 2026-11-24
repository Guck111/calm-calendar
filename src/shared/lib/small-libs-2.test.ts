import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "../api/types";
import { t } from "../i18n";
import { parseDriveLink } from "./attachments";
import { placeBeside } from "./beside";
import { buildCommands, commandLabel } from "./commands";
import { placeLink } from "./maps";
import { mergeSharedMeetings } from "./shared-meetings";

const at = (d: number, h: number) => new Date(2026, 10, d, h);
const ev = (key: string, account: string, calendar: string, start: Date, iCalUID?: string): CalendarEvent => ({
  key, id: key, calendarId: `${account}\u0000${calendar}`, account, title: key, start, end: new Date(start.getTime() + 3_600_000),
  allDay: false, recurring: false, ...(iCalUID ? { iCalUID } : {}),
});

describe("one meeting in several accounts", () => {
  it("occurrences of a series are merged one by one, not into one", () => {
    const events = [ev("m1", "me", "primary", at(4, 9), "s"), ev("m2", "me", "primary", at(5, 9), "s"),
      ev("w1", "work", "primary", at(4, 9), "s"), ev("w2", "work", "primary", at(5, 9), "s")];
    expect(mergeSharedMeetings(events, new Set()).map((e) => e.key)).toEqual(["m1", "m2"]);
  });

  it("events without an iCalUID are never merged", () => {
    const events = [ev("a", "me", "primary", at(4, 9)), ev("b", "work", "primary", at(4, 9))];
    expect(mergeSharedMeetings(events, new Set())).toEqual(events);
  });

  it("the writable copy stays, other accounts go to alsoIn, a copy in another calendar of the same account stays as is", () => {
    const events = [ev("mine", "me", "primary", at(4, 9), "x"), ev("team", "me", "team", at(4, 9), "x"), ev("work", "work", "primary", at(4, 9), "x")];
    const merged = mergeSharedMeetings(events, new Set(["me\u0000primary"]));
    expect(merged.map((e) => [e.key, e.alsoIn])).toEqual([["mine", ["work\u0000primary"]], ["team", undefined]]);
  });
});

describe("event card beside its block", () => {
  const card = { width: 300, height: 200 };
  const viewport = { width: 1000, height: 800 };
  const block = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

  it("a side or edge exactly at the margin still fits", () => {
    expect(placeBeside(block(380, 100, 300, 50), card, viewport)?.left).toBe(688);
    expect(placeBeside(block(320, 100, 600, 50), card, viewport)?.left).toBe(12);
    expect(placeBeside(block(0, 380, 1000, 200), card, viewport)?.top).toBe(588);
    expect(placeBeside(block(0, 220, 1000, 500), card, viewport)?.top).toBe(12);
  });

  it("a card that would cross the right margin goes to the left", () => {
    expect(placeBeside(block(400, 100, 300, 50), card, viewport)?.left).toBe(92);
  });

  it("a window just big enough for the card and its margins still places it", () => {
    expect(placeBeside(block(0, 0, 4, 10), card, { width: 324, height: 224 })).toEqual({ left: 12, top: 12 });
  });
});

describe("Google Drive links", () => {
  it("Sheets, Slides and Forms links become attachments of their type", () => {
    expect(parseDriveLink("https://docs.google.com/spreadsheets/d/abc/edit")?.mimeType).toBe("application/vnd.google-apps.spreadsheet");
    expect(parseDriveLink("https://docs.google.com/presentation/d/abc")?.mimeType).toBe("application/vnd.google-apps.presentation");
    expect(parseDriveLink("https://docs.google.com/forms/d/abc")?.mimeType).toBe("application/vnd.google-apps.form");
    expect(parseDriveLink("https://drive.google.com/file/d/abc/view")?.title).toBe("Google Drive");
  });
});

describe("map links", () => {
  it("only a whole http or https link is opened as is", () => {
    expect(placeLink("http://example.com/room")).toBe("http://example.com/room");
    expect(placeLink("see https://example.com")).toBe("https://www.google.com/maps/search/?api=1&query=see%20https%3A%2F%2Fexample.com");
    expect(placeLink("https://example.com here")).toBe("https://www.google.com/maps/search/?api=1&query=https%3A%2F%2Fexample.com%20here");
  });
});

describe("command menu", () => {
  const now = new Date(2026, 10, 4, 18);

  it("labels of 'new event' and the shortcuts list", () => {
    expect(commandLabel({ kind: "new" })).toBe(t.common.newEvent);
    expect(commandLabel({ kind: "shortcuts" })).toBe(t.shortcuts.title);
  });

  it("an all-day event with a call has only 'to tomorrow', spaces are no text", () => {
    expect(buildCommands("   ", now, { title: "x", allDay: true, hasMeet: true })[0]).toEqual({ kind: "tomorrow" });
    expect(buildCommands("   ", now, { title: "x", allDay: true, hasMeet: true })[1]).toEqual({ kind: "new" });
  });
});
