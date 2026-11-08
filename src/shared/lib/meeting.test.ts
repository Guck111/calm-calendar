import { describe, expect, it } from "vitest";
import { findMeeting, isJoinable } from "./meeting";

describe("findMeeting", () => {
  it("takes the video entry point of conferenceData first", () => {
    expect(
      findMeeting({
        hangoutLink: "https://meet.google.com/aaa-bbbb-ccc",
        conferenceData: {
          conferenceSolution: { name: "Zoom Meeting" },
          entryPoints: [
            { entryPointType: "phone", uri: "tel:+1-555-0100" },
            { entryPointType: "video", uri: "https://us02web.zoom.us/j/8123456789?pwd=abc" },
          ],
        },
      }),
    ).toEqual({ url: "https://us02web.zoom.us/j/8123456789?pwd=abc", provider: "Zoom" });
  });

  it("names an unknown conference by its solution", () => {
    expect(
      findMeeting({
        conferenceData: { conferenceSolution: { name: "Acme Rooms" }, entryPoints: [{ entryPointType: "video", uri: "https://rooms.acme.example/x" }] },
      }),
    ).toEqual({ url: "https://rooms.acme.example/x", provider: "Acme Rooms" });
  });

  it("falls back to hangoutLink", () => {
    expect(findMeeting({ hangoutLink: "https://meet.google.com/abc-defg-hij" })).toEqual({
      url: "https://meet.google.com/abc-defg-hij",
      provider: "Google Meet",
    });
  });

  it("finds links in the location and in HTML descriptions", () => {
    expect(findMeeting({ location: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_x/0?context=%7b%7d" })?.provider).toBe(
      "Microsoft Teams",
    );
    const description =
      'Join: <a href="https://acme.zoom.us/j/5551234?pwd=x1&amp;from=addon">https://acme.zoom.us/j/5551234?pwd=x1&amp;from=addon</a>.';
    expect(findMeeting({ description })).toEqual({ url: "https://acme.zoom.us/j/5551234?pwd=x1&from=addon", provider: "Zoom" });
    expect(findMeeting({ description: "Созвон: https://telemost.yandex.ru/j/12345678901234." })).toEqual({
      url: "https://telemost.yandex.ru/j/12345678901234",
      provider: "Telemost",
    });
  });

  it("ignores ordinary links and events without a call", () => {
    expect(findMeeting({ description: "Agenda: https://docs.google.com/document/d/1 and https://zoom.us/pricing" })).toBeUndefined();
    expect(findMeeting({ location: "Office, room 4" })).toBeUndefined();
    expect(findMeeting({})).toBeUndefined();
  });
});

describe("isJoinable", () => {
  const start = new Date(2026, 10, 4, 10, 0);
  const end = new Date(2026, 10, 4, 11, 0);
  it("from 15 minutes before the start until the end", () => {
    expect(isJoinable(start, end, new Date(2026, 10, 4, 9, 44))).toBe(false);
    expect(isJoinable(start, end, new Date(2026, 10, 4, 9, 45))).toBe(true);
    expect(isJoinable(start, end, new Date(2026, 10, 4, 10, 30))).toBe(true);
    expect(isJoinable(start, end, end)).toBe(false);
  });
});
