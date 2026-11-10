// Quick add in every language: the phrase from docs/features.md, the preview, Enter creates the event
// tomorrow (Thursday 12 November) at 19:00 for 50 minutes.
import type { Lang } from "../../src/shared/i18n";
import { test, expect, openApp, eventBlock, rangeText, dayOfBlock, dayNumber, escapeRe } from "./fixtures";

const EXAMPLES: Record<Lang, { text: string; title: string }> = {
  en: { text: "tomorrow 7pm English class 50 min", title: "English class" },
  ru: { text: "завтра 19:00 английский 50 мин", title: "английский" },
  es: { text: "mañana a las 19:00 clase de inglés 50 min", title: "clase de inglés" },
  fr: { text: "demain 19h cours d'anglais 50 min", title: "cours d'anglais" },
  pt: { text: "amanhã 19h aula de inglês 50 min", title: "aula de inglês" },
  de: { text: "morgen 19 Uhr Englischkurs 50 min", title: "Englischkurs" },
  ja: { text: "明日19時 英会話 50分", title: "英会話" },
  zh: { text: "明天晚上7点 英语课 50分钟", title: "英语课" },
  hi: { text: "कल शाम 7 बजे इंग्लिश क्लास 50 मिनट", title: "इंग्लिश क्लास" },
  ar: { text: "غدًا الساعة 7 مساءً درس إنجليزي 50 دقيقة", title: "درس إنجليزي" },
  bn: { text: "কাল সন্ধ্যা 7টায় ইংরেজি ক্লাস 50 মিনিট", title: "ইংরেজি ক্লাস" },
};

for (const [lang, { text, title }] of Object.entries(EXAMPLES) as [Lang, (typeof EXAMPLES)[Lang]][]) {
  test.describe(lang, () => {
    test.use({ lang });

    test(`quick add: ${text}`, async ({ page, t }) => {
      await openApp(page);
      const input = page.getByRole("textbox", { name: t.quick.label });
      await input.fill(text);
      await expect(page.locator('[aria-live="polite"]')).toContainText(title);
      await input.press("Enter");
      await expect(input).toHaveValue("");

      const block = eventBlock(page, title);
      const range = await rangeText(page, 12, [19, 0], [19, 50]);
      await expect(block).toHaveAttribute("title", new RegExp(`^${escapeRe(range)} `));
      expect(await dayOfBlock(page, block)).toBe(await dayNumber(page, 12));
    });
  });
}

test("quick add: Ctrl+Enter opens the full form filled in", async ({ page, t }) => {
  await openApp(page);
  const input = page.getByRole("textbox", { name: t.quick.label });
  await input.fill("fri 18 Call with Ola @Gdynia");
  await input.press("Control+Enter");
  const form = page.getByRole("dialog", { name: t.common.newEvent });
  await expect(form.getByPlaceholder(t.editor.titlePlaceholder)).toHaveValue("Call with Ola");
  await expect(form.getByLabel(t.editor.startDate)).toHaveValue("2026-11-13");
  await expect(form.getByLabel(t.editor.startTime)).toHaveValue("18:00");
  await expect(form.getByLabel(t.common.location)).toHaveValue("Gdynia");
});

test("quick add: a click on the preview creates the event; a Russian phrase in the English interface", async ({
  page,
  t,
}) => {
  await openApp(page);
  const input = page.getByRole("textbox", { name: t.quick.label });
  await input.fill("занятие спортом в 12:00, 14");
  const preview = page.getByRole("button", { name: /занятие спортом/ });
  await expect(preview).toContainText("14 November · 12:00–13:00");
  await preview.click();
  await expect(input).toHaveValue("");
  const block = eventBlock(page, "занятие спортом");
  const range = await rangeText(page, 14, [12, 0], [13, 0]);
  await expect(block).toHaveAttribute("title", new RegExp(`^${escapeRe(range)} `));
  expect(await dayOfBlock(page, block)).toBe(await dayNumber(page, 14));
});

test("quick add: N focuses the field, a phrase without a title is refused", async ({ page, t }) => {
  await openApp(page);
  await page.keyboard.press("n");
  const input = page.getByRole("textbox", { name: t.quick.label });
  await expect(input).toBeFocused();
  await input.fill("tomorrow 7pm");
  await input.press("Enter");
  await expect(page.locator('[aria-live="polite"]')).toContainText(t.errors.titleRequired);
});
