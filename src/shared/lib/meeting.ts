// Video meeting link in an event: Google Meet from conferenceData or hangoutLink,
// and Zoom, Teams and the rest — as a link in the location or description (that's how add-ons and invitations add them).

export type Meeting = { url: string; provider: string };

/** Service names are trademarks, not translated */
const PROVIDERS: [RegExp, string][] = [
  [/^https:\/\/meet\.google\.com\/[a-z]{3,}-[a-z]{3,}-[a-z]{3,}/i, "Google Meet"],
  [/^https:\/\/([\w-]+\.)?zoom\.(us|com)\/(j|my|w|s)\//i, "Zoom"],
  [/^https:\/\/([\w-]+\.)?zoomgov\.com\/(j|my|w|s)\//i, "Zoom"],
  [/^https:\/\/teams\.(microsoft|live)\.com\/(l\/meetup-join|meet)\//i, "Microsoft Teams"],
  [/^https:\/\/([\w-]+\.)?webex\.com\/(meet|join|[\w-]+\/j\.php|wbxmjs)/i, "Webex"],
  [/^https:\/\/telemost\.yandex\.(ru|com)\/j\//i, "Telemost"],
  [/^https:\/\/meet\.jit\.si\/[^/\s]+/i, "Jitsi Meet"],
  [/^https:\/\/whereby\.com\/[^/\s]+/i, "Whereby"],
  [/^https:\/\/(meet\.goto\.com|global\.gotomeeting\.com\/join)\//i, "GoTo Meeting"],
  [/^https:\/\/([\w-]+\.)?chime\.aws\/\d+/i, "Amazon Chime"],
  [/^https:\/\/join\.skype\.com\/[\w]+/i, "Skype"],
];

const providerOf = (url: string): string | undefined => PROVIDERS.find(([re]) => re.test(url))?.[1];

// in the description a link may be inside HTML: href="…", with &amp; instead of &, with a period or bracket after it
const URL_IN_TEXT = /https:\/\/[^\s"'<>()]+/gi;

const cleanUrl = (raw: string): string => raw.replace(/&amp;/g, "&").replace(/[.,;:!?)\]]+$/, "");

/** First link of a known service in the text */
export const findMeetingInText = (text: string | undefined): Meeting | undefined => {
  if (!text) return undefined;
  for (const m of text.matchAll(URL_IN_TEXT)) {
    const url = cleanUrl(m[0]);
    const provider = providerOf(url);
    if (provider) return { url, provider };
  }
  return undefined;
};

type EntryPoint = { entryPointType?: string; uri?: string };
export type MeetingSource = {
  hangoutLink?: string;
  conferenceData?: { entryPoints?: EntryPoint[]; conferenceSolution?: { name?: string } };
  location?: string;
  description?: string;
};

export const findMeeting = (e: MeetingSource): Meeting | undefined => {
  // conferenceData is what the calendar itself considers a video meeting (Meet and Zoom, Teams add-ons)
  const video = e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video" && p.uri?.startsWith("https://"));
  if (video?.uri) {
    return { url: video.uri, provider: providerOf(video.uri) ?? e.conferenceData?.conferenceSolution?.name ?? "Video call" };
  }
  if (e.hangoutLink?.startsWith("https://")) return { url: e.hangoutLink, provider: "Google Meet" };
  return findMeetingInText(e.location) ?? findMeetingInText(e.description);
};

/** The "Join" button is shown in advance: 15 minutes before the start and until the meeting ends */
export const JOIN_EARLY_MS = 15 * 60_000;
export const isJoinable = (start: Date, end: Date, now: Date): boolean =>
  now.getTime() >= start.getTime() - JOIN_EARLY_MS && now < end;

/** Short location for a list row: a call link — the service name, another link — the site,
 *  an address — as is. Zoom and Teams invitations often put a long link with a password into the location */
export const shortPlace = (location: string, meeting: Meeting | undefined): string => {
  const text = location.trim();
  if (!/^https?:\/\//i.test(text)) return text;
  const provider = providerOf(text) ?? (meeting && text.startsWith(meeting.url) ? meeting.provider : undefined);
  if (provider) return provider;
  try {
    return new URL(text).hostname;
  } catch {
    return text;
  }
};
