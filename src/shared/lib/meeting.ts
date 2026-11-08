// Ссылка на видеовстречу в событии: Google Meet из conferenceData или hangoutLink,
// а Zoom, Teams и остальные — ссылкой в месте или описании (так их добавляют дополнения и приглашения).

export type Meeting = { url: string; provider: string };

/** Названия сервисов — торговые марки, не переводятся */
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

// в описании ссылка бывает внутри HTML: href="…", с &amp; вместо &, с точкой или скобкой после
const URL_IN_TEXT = /https:\/\/[^\s"'<>()]+/gi;

const cleanUrl = (raw: string): string => raw.replace(/&amp;/g, "&").replace(/[.,;:!?)\]]+$/, "");

/** Первая ссылка известного сервиса в тексте */
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
  // conferenceData — то, что календарь сам считает видеовстречей (Meet и дополнения Zoom, Teams)
  const video = e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video" && p.uri?.startsWith("https://"));
  if (video?.uri) {
    return { url: video.uri, provider: providerOf(video.uri) ?? e.conferenceData?.conferenceSolution?.name ?? "Video call" };
  }
  if (e.hangoutLink?.startsWith("https://")) return { url: e.hangoutLink, provider: "Google Meet" };
  return findMeetingInText(e.location) ?? findMeetingInText(e.description);
};

/** Кнопку «Подключиться» показываем заранее: за 15 минут до начала и до конца встречи */
export const JOIN_EARLY_MS = 15 * 60_000;
export const isJoinable = (start: Date, end: Date, now: Date): boolean =>
  now.getTime() >= start.getTime() - JOIN_EARLY_MS && now < end;
