// Feedback from Settings → Help: a letter to support that opens in the user's own mail app.
// The app sends nothing itself, so the user sees everything that goes out.

export const SUPPORT_EMAIL = "support@calmcalendar.co.uk";

export const FEEDBACK_KINDS = ["idea", "problem", "question"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** build: where the app came from (Microsoft Store, installer); system: the WebView2 and Windows line */
export type AppInfo = { version: string; build: string; language: string; system: string };

export type Letter = { subject: string; message: string; details: string };

/** longer links are cut or refused by mail apps and Windows */
const MAX_LINK = 1900;

export const feedbackLetter = (kindName: string, message: string, app: AppInfo): Letter => ({
  subject: `Calm Calendar ${app.version}: ${kindName}`,
  message: message.trim(),
  details: `Calm Calendar ${app.version} (${app.build})\nLanguage: ${app.language}\n${app.system}`,
});

const withDetails = (text: string, details: string) => `${text}\n\n---\n${details}`;

/** The letter's text: the message, then what helps to answer it */
export const letterText = ({ message, details }: Letter): string => withDetails(message, details);

const mailto = (subject: string, body: string) =>
  `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

/** Link that opens the letter in the mail app. whole: the message is in it; when the message is too long
 *  for a link, pasteNote stands in its place and the caller puts the message on the clipboard */
export const feedbackMail = (letter: Letter, pasteNote: string): { href: string; whole: boolean } => {
  const href = mailto(letter.subject, letterText(letter));
  if (href.length <= MAX_LINK) return { href, whole: true };
  return { href: mailto(letter.subject, withDetails(pasteNote, letter.details)), whole: false };
};
