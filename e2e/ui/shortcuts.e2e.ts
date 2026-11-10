// The list of keyboard shortcuts: "?" or "Keyboard shortcuts" in the command menu.
import { test, expect, openApp } from "./fixtures";

test("? opens the list of shortcuts, Esc closes it", async ({ page, t }) => {
  await openApp(page);
  await page.keyboard.press("Shift+Slash");
  const list = page.getByRole("dialog", { name: t.shortcuts.title });
  await expect(list).toBeVisible();
  await expect(list).toContainText(t.shortcuts.commands);
  await expect(list.locator("kbd").filter({ hasText: /^K$/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
});

test("from the command menu", async ({ page, t }) => {
  await openApp(page);
  await page.keyboard.press("Control+k");
  await page.keyboard.type(t.shortcuts.title.slice(0, 5));
  await page.getByRole("option", { name: t.shortcuts.title }).click();
  await expect(page.getByRole("dialog", { name: t.shortcuts.title })).toBeVisible();
});

test("? in a text field is just a character", async ({ page, t }) => {
  await openApp(page);
  const input = page.getByRole("textbox", { name: t.quick.label });
  await input.fill("lunch?");
  await expect(page.getByRole("dialog", { name: t.shortcuts.title })).toHaveCount(0);
});

test.describe("in Russian", () => {
  test.use({ lang: "ru" });
  test("the list is translated", async ({ page, t }) => {
    await openApp(page);
    await page.keyboard.press("Shift+Slash");
    await expect(page.getByRole("dialog", { name: t.shortcuts.title })).toContainText(t.shortcuts.onEvent);
  });
});
