// Events without the mouse: arrows between event blocks, Enter, E, Ctrl+D, Delete.
import type { Page } from "@playwright/test";
import { test, expect, openApp, eventBlock, dialog, dayOfBlock } from "./fixtures";

const focusedTitle = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.closest("[data-event-key]")?.textContent ?? "");

test("↓ enters the events, arrows move between them, ← → do not change the week while on an event", async ({ page }) => {
  await openApp(page);
  const heading = page.locator("main header h2");
  const week = await heading.innerText();
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => focusedTitle(page)).not.toBe("");
  const first = page.locator(":focus");
  const day = await dayOfBlock(page, first);
  await page.keyboard.press("ArrowRight");
  const next = page.locator(":focus");
  expect(Number(await dayOfBlock(page, next))).toBeGreaterThan(Number(day));
  await expect(heading).toHaveText(week);
});

test("Enter opens the card, Esc closes it and the event keeps the focus", async ({ page }) => {
  await openApp(page);
  await eventBlock(page, "Dentist").focus();
  await page.keyboard.press("Enter");
  await expect(dialog(page)).toContainText("Dentist");
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
  await expect.poll(() => focusedTitle(page)).toMatch(/Dentist/);
});

test("E edits the event", async ({ page, t }) => {
  await openApp(page);
  await eventBlock(page, "Dentist").focus();
  await page.keyboard.press("e");
  const form = page.getByRole("dialog", { name: t.common.event });
  await expect(form.getByPlaceholder(t.editor.titlePlaceholder)).toHaveValue("Dentist");
});

test("Ctrl+D duplicates the event", async ({ page, t }) => {
  await openApp(page);
  await eventBlock(page, "Dentist").focus();
  await page.keyboard.press("Control+d");
  const form = page.getByRole("dialog", { name: t.common.newEvent });
  await expect(form.getByPlaceholder(t.editor.titlePlaceholder)).toHaveValue("Dentist");
});

test("Delete asks in the card, Enter deletes", async ({ page, t }) => {
  await openApp(page);
  await eventBlock(page, "Dentist").focus();
  await page.keyboard.press("Delete");
  const confirm = dialog(page).getByRole("button", { name: t.editor.confirmDelete });
  await expect(confirm).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog(page)).toBeHidden();
  await expect(page.locator("main button[title]").filter({ hasText: "Dentist" })).toHaveCount(0);
});

test("Schedule: ↓ goes down the list", async ({ page }) => {
  await openApp(page);
  await page.keyboard.press("a");
  await page.keyboard.press("ArrowDown");
  const first = await focusedTitle(page);
  expect(first).not.toBe("");
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => focusedTitle(page)).not.toBe(first);
});
