import { describe, expect, it } from "vitest";
import { SUPPORT_EMAIL, feedbackLetter, feedbackMail, letterText } from "./feedback";

const app = { version: "0.12.4", build: "Microsoft Store", language: "ru", system: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" };

const parse = (href: string) => {
  const url = new URL(href);
  return { to: url.pathname, subject: url.searchParams.get("subject"), body: url.searchParams.get("body") };
};

describe("feedback letter", () => {
  it("names the app, its version and the kind of message in the subject", () => {
    expect(feedbackLetter("Problem", "The widget is gone", app).subject).toBe("Calm Calendar 0.12.4: Problem");
  });

  it("puts the user's text first, then what helps to answer", () => {
    const letter = feedbackLetter("Problem", "  The widget is gone\n", app);
    expect(letterText(letter)).toBe(
      "The widget is gone\n\n---\nCalm Calendar 0.12.4 (Microsoft Store)\nLanguage: ru\nMozilla/5.0 (Windows NT 10.0; Win64; x64)",
    );
  });
});

describe("link for the mail app", () => {
  const paste = "(Paste the copied text here: Ctrl+V)";

  it("goes to support with the whole letter", () => {
    const letter = feedbackLetter("Вопрос", "Как добавить второй аккаунт? & почему 100%", app);
    const mail = feedbackMail(letter, paste);
    expect(mail.whole).toBe(true);
    expect(parse(mail.href)).toEqual({ to: SUPPORT_EMAIL, subject: letter.subject, body: letterText(letter) });
  });

  it("keeps line breaks of the message", () => {
    const mail = feedbackMail(feedbackLetter("Idea", "one\ntwo", app), paste);
    expect(parse(mail.href).body).toMatch(/^one\ntwo\n\n---\n/);
  });

  it("a long letter does not fit into a link: the link asks to paste the text and keeps the details", () => {
    const letter = feedbackLetter("Ошибка", "Очень длинный текст. ".repeat(60), app);
    const mail = feedbackMail(letter, paste);
    expect(mail.whole).toBe(false);
    expect(mail.href.length).toBeLessThanOrEqual(1900);
    const { to, subject, body } = parse(mail.href);
    expect(to).toBe(SUPPORT_EMAIL);
    expect(subject).toBe(letter.subject);
    expect(body).toBe(`${paste}\n\n---\n${letter.details}`);
  });
});
