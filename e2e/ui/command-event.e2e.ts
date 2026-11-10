// Ctrl+K on a chosen event: move to tomorrow, an hour later, add Google Meet, a color.
import type { Page } from "@playwright/test";
import { test, expect, openApp, eventBlock, dialog, blockOn } from "./fixtures";
import type { en } from "../../src/shared/i18n/en";

const menuOn = async (page: Page, t: typeof en, title: string) => {
  await eventBlock(page, title).focus();
  await page.keyboard.press("Control+k");
  const menu = page.getByRole("dialog", { name: t.commands.title });
  await expect(menu).toContainText(title);
  return menu;
};

test("move to tomorrow", async ({ page, t }) => {
  await openApp(page);
  const menu = await menuOn(page, t, "Dentist");
  await menu.getByRole("option", { name: t.commands.moveTomorrow }).click();
  await expect(menu).toBeHidden();
  await expect(await blockOn(page, "Dentist", 12)).toHaveAttribute("title", /^16:00–16:45 /);
});

test("an hour later", async ({ page, t }) => {
  await openApp(page);
  await menuOn(page, t, "Dentist");
  await expect(page.getByRole("option").first()).toHaveText(t.commands.moveTomorrow);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(await blockOn(page, "Dentist", 11)).toHaveAttribute("title", /^17:00–17:45 /);
});

test("add Google Meet", async ({ page, t }) => {
  await openApp(page);
  const menu = await menuOn(page, t, "Dentist");
  await menu.getByRole("option", { name: t.editor.addMeet }).click();
  await expect(menu).toBeHidden();
  // the card shows the event as reloaded from Google after saving
  await expect(async () => {
    await page.keyboard.press("Escape");
    await eventBlock(page, "Dentist").click();
    await expect(dialog(page).getByRole("button", { name: new RegExp(t.meeting.join) })).toContainText("Google Meet", {
      timeout: 500,
    });
  }).toPass({ timeout: 5000 });
});

test("a color by its name", async ({ page, t }) => {
  await openApp(page);
  await menuOn(page, t, "Dentist");
  await page.keyboard.type("tomato");
  await page.getByRole("option", { name: t.commands.color(t.editor.colorNames["11"]) }).click();
  await expect(eventBlock(page, "Dentist")).toHaveAttribute("style", /--c: #d50000/);
});
