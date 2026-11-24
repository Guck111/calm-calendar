import { describe, expect, it } from "vitest";
import { findMeeting, findMeetingInText, shortPlace } from "./meeting";

const MEET = "https://meet.google.com/abc-defg-hij";

describe("video call links", () => {
  it.each([
    [MEET, "Google Meet"],
    ["https://zoom.us/j/123", "Zoom"],
    ["https://us02web.zoom.us/j/123", "Zoom"],
    ["https://zoomgov.com/j/123", "Zoom"],
    ["https://agency.zoomgov.com/j/123", "Zoom"],
    ["https://teams.microsoft.com/l/meetup-join/19%3a", "Microsoft Teams"],
    ["https://webex.com/meet/team", "Webex"],
    ["https://company.webex.com/company/j.php?MTID=m1", "Webex"],
    ["https://telemost.yandex.ru/j/123", "Telemost"],
    ["https://meet.jit.si/TeamRoom", "Jitsi Meet"],
    ["https://whereby.com/team-room", "Whereby"],
    ["https://meet.goto.com/123456789", "GoTo Meeting"],
    ["https://chime.aws/1234567890", "Amazon Chime"],
    ["https://app.chime.aws/1234567890", "Amazon Chime"],
    ["https://join.skype.com/AbCdEf", "Skype"],
  ])("%s is %s", (url, provider) => expect(findMeetingInText(`Join: ${url}`)).toEqual({ url, provider }));

  it.each([
    "https://meet.google.com/abc-def-gh",
    "https://example.com/r?u=https://meet.google.com/abc-defg-hij",
    "https://example.com/r?u=https://zoom.us/j/1",
    "https://example.com/r?u=https://zoomgov.com/j/1",
    "https://example.com/r?u=https://teams.microsoft.com/meet/1",
    "https://example.com/r?u=https://webex.com/meet/team",
    "https://example.com/r?u=https://telemost.yandex.ru/j/1",
    "https://example.com/r?u=https://meet.jit.si/Room",
    "https://example.com/r?u=https://whereby.com/room",
    "https://example.com/r?u=https://meet.goto.com/1",
    "https://example.com/r?u=https://chime.aws/1",
    "https://example.com/r?u=https://join.skype.com/Ab",
  ])("%s is not a call link", (url) => expect(findMeetingInText(`See ${url}`)).toBeUndefined());

  it("all punctuation after a link is dropped", () => {
    expect(findMeetingInText("(call: https://zoom.us/j/123).")?.url).toBe("https://zoom.us/j/123");
    expect(findMeetingInText("Join https://zoom.us/j/123!?")?.url).toBe("https://zoom.us/j/123");
  });
});

describe("video call of an event", () => {
  it("only a video entry point with an https link counts", () => {
    expect(findMeeting({
      conferenceData: { entryPoints: [{ entryPointType: "more", uri: "https://tel.meet/abc" }, { entryPointType: "video", uri: MEET }] },
    })).toEqual({ url: MEET, provider: "Google Meet" });
    expect(findMeeting({
      conferenceData: { entryPoints: [{ entryPointType: "video" }, { entryPointType: "video", uri: "http://insecure.example/x" }] },
      hangoutLink: MEET,
    })).toEqual({ url: MEET, provider: "Google Meet" });
  });

  it("conference data without entry points falls back to the Meet link", () => {
    expect(findMeeting({ conferenceData: { conferenceSolution: { name: "Acme" } }, hangoutLink: MEET })?.url).toBe(MEET);
  });

  it("an unknown video link without a solution name is a video call", () => {
    expect(findMeeting({ conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://video.example.com/x" }] } }))
      .toEqual({ url: "https://video.example.com/x", provider: "Video call" });
  });

  it("a Meet link that is not https is ignored", () => {
    expect(findMeeting({ hangoutLink: "http://meet.google.com/abc-defg-hij" })).toBeUndefined();
  });
});

describe("short place", () => {
  const acme = { url: "https://video.example.com/room", provider: "Acme Video" };

  it("a call link with spaces around reads as the service", () => {
    expect(shortPlace("  https://zoom.us/j/1  ", undefined)).toBe("Zoom");
  });

  it("a longer link to the event's own call reads as its service", () => {
    expect(shortPlace("https://video.example.com/room?pwd=1", acme)).toBe("Acme Video");
    expect(shortPlace("https://other.example.com/x/https://video.example.com/room", acme)).toBe("other.example.com");
  });

  it("an http link reads as its site, other text stays as it is", () => {
    expect(shortPlace("http://example.com/path", undefined)).toBe("example.com");
    expect(shortPlace("mailto:team@example.com", undefined)).toBe("mailto:team@example.com");
    expect(shortPlace("http://", undefined)).toBe("http://");
  });
});
