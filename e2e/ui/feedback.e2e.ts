// Settings → Help → "Write to us": a suggestion, a problem or a question becomes a letter to support
// that opens in the user's own mail app. The app sends nothing itself.
import type { Page } from "@playwright/test";
import { test, expect, openApp, openSettings } from "./fixtures";

const SUPPORT = "support@calmcalendar.co.uk";

/** remember the links the page opens instead of opening them */
const catchOpened = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { opened: string[] };
    w.opened = [];
    window.open = (url?: string | URL) => {
      w.opened.push(String(url));
      return null;
    };
  });
const opened = (page: Page) => page.evaluate(() => (window as unknown as { opened: string[] }).opened);

const letterOf = (href: string) => {
  const url = new URL(href);
  return { to: url.pathname, subject: url.searchParams.get("subject") ?? "", body: url.searchParams.get("body") ?? "" };
};

const appVersion = (page: Page) =>
  page.evaluate(async () => {
    const path = "/src/shared/lib/version.ts";
    return (await import(/* @vite-ignore */ path)).APP_VERSION as string;
  });

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("Help is a section of Settings with the form; nothing can be sent while the message is empty", async ({ page, t }) => {
  await openApp(page);
  const settings = await openSettings(page, t, "groupHelp");
  const help = settings.getByRole("tabpanel", { name: t.settings.groupHelp });
  await expect(help).toContainText(t.settings.feedbackText);
  await expect(help).toContainText(SUPPORT);
  const kinds = help.getByRole("radiogroup", { name: t.settings.feedback }).getByRole("radio");
  await expect(kinds).toHaveText([t.settings.feedbackKinds.idea, t.settings.feedbackKinds.problem, t.settings.feedbackKinds.question]);
  await expect(kinds.first()).toHaveAttribute("aria-checked", "true");
  await expect(help.getByRole("button", { name: t.settings.feedbackSend })).toBeDisabled();
  await expect(help.getByRole("button", { name: t.settings.feedbackCopy })).toBeDisabled();
  await help.getByRole("textbox", { name: t.settings.feedbackMessage }).fill("   ");
  await expect(help.getByRole("button", { name: t.settings.feedbackSend })).toBeDisabled();
});

test("a problem report opens as a letter to support with the app version", async ({ page, t }) => {
  await openApp(page);
  await catchOpened(page);
  const settings = await openSettings(page, t, "groupHelp");
  await settings.getByRole("radio", { name: t.settings.feedbackKinds.problem }).click();
  await settings.getByRole("textbox", { name: t.settings.feedbackMessage }).fill("The widget is gone\nafter an update & restart");
  await settings.getByRole("button", { name: t.settings.feedbackSend }).click();

  await expect.poll(() => opened(page)).toHaveLength(1);
  const [href] = await opened(page);
  const version = await appVersion(page);
  const letter = letterOf(href);
  expect(letter.to).toBe(SUPPORT);
  expect(letter.subject).toBe(`Calm Calendar ${version}: ${t.settings.feedbackKinds.problem}`);
  expect(letter.body).toMatch(/^The widget is gone\nafter an update & restart\n\n---\n/);
  expect(letter.body).toContain(`Calm Calendar ${version} (browser)`);
  expect(letter.body).toContain("Language: en");
  // the text stays in the form: the mail app may not have opened
  await expect(settings.getByRole("textbox", { name: t.settings.feedbackMessage })).toHaveValue(/The widget is gone/);
});

test("Copy puts the whole letter on the clipboard and says where to send it", async ({ page, t }) => {
  await openApp(page);
  const settings = await openSettings(page, t, "groupHelp");
  await settings.getByRole("radio", { name: t.settings.feedbackKinds.question }).click();
  await settings.getByRole("textbox", { name: t.settings.feedbackMessage }).fill("How do I add a second account?");
  await settings.getByRole("button", { name: t.settings.feedbackCopy }).click();
  await expect(settings.getByRole("status")).toHaveText(t.settings.feedbackCopied(SUPPORT));
  // Windows hands the clipboard text back with its own line ends
  const copied = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n");
  expect(copied).toMatch(/^How do I add a second account\?\n\n---\nCalm Calendar \d+\.\d+\.\d+ \(browser\)\n/);
  // a new edit hides the note
  await settings.getByRole("textbox", { name: t.settings.feedbackMessage }).pressSequentially(" Thanks");
  await expect(settings.getByRole("status")).toHaveCount(0);
});

test.describe("in Russian", () => {
  test.use({ lang: "ru" });

  test("a long text does not fit into a link: it is copied, and the letter asks to paste it", async ({ page, t }) => {
    await openApp(page);
    await catchOpened(page);
    const settings = await openSettings(page, t, "groupHelp");
    const text = "Очень длинное описание ошибки. ".repeat(40).trim();
    await settings.getByRole("textbox", { name: t.settings.feedbackMessage }).fill(text);
    await settings.getByRole("button", { name: t.settings.feedbackSend }).click();

    await expect.poll(() => opened(page)).toHaveLength(1);
    const [href] = await opened(page);
    expect(href.length).toBeLessThanOrEqual(1900);
    const letter = letterOf(href);
    expect(letter.subject).toContain(t.settings.feedbackKinds.idea);
    expect(letter.body.startsWith(t.settings.feedbackPaste)).toBe(true);
    expect(letter.body).toContain("Language: ru");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);
    await expect(settings.getByRole("status")).toHaveText(t.settings.feedbackLong);
  });
});
