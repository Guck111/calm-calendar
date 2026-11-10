// "Duplicate" in the event card: the form of a new event filled from the old one.
import { test, expect, openApp, eventBlock, dialog, blockOn } from "./fixtures";

test("duplicate an event to another day: both are there", async ({ page, t }) => {
  await openApp(page);
  await eventBlock(page, "Dentist").click();
  await dialog(page).getByRole("button", { name: t.editor.duplicate }).click();
  const form = page.getByRole("dialog", { name: t.common.newEvent });
  await expect(form.getByPlaceholder(t.editor.titlePlaceholder)).toHaveValue("Dentist");
  await expect(form.getByLabel(t.common.location)).toHaveValue("Main St Clinic");
  await expect(form.getByLabel(t.editor.startTime)).toHaveValue("16:00");
  await form.getByLabel(t.editor.startDate).fill("2026-11-13");
  await form.getByRole("button", { name: t.common.save }).click();
  await expect(form).toBeHidden();
  await expect(await blockOn(page, "Dentist", 13)).toHaveAttribute("title", /^16:00–16:45 /);
  await expect(await blockOn(page, "Dentist", 11)).toBeVisible();
});

test("an occurrence of a series is copied as a single event", async ({ page, t }) => {
  await openApp(page);
  await (await blockOn(page, "Team standup", 12)).click();
  await dialog(page).getByRole("button", { name: t.editor.duplicate }).click();
  const form = page.getByRole("dialog", { name: t.common.newEvent });
  await expect(form.getByLabel(t.repeat.label)).toHaveValue("none");
  await form.getByPlaceholder(t.editor.titlePlaceholder).fill("Extra standup");
  await form.getByRole("button", { name: t.common.save }).click();
  await expect(await blockOn(page, "Extra standup", 12)).toBeVisible();
  await page.getByRole("button", { name: t.toolbar.forward }).click();
  await expect(page.locator("main button[title]").filter({ hasText: "Team standup" }).first()).toBeVisible();
  await expect(page.locator("main button[title]").filter({ hasText: "Extra standup" })).toHaveCount(0);
});

test.describe("in Arabic", () => {
  test.use({ lang: "ar" });
  test("the button is translated", async ({ page, t }) => {
    await openApp(page);
    await page.locator("main [class*='column'] > button").first().click();
    await expect(dialog(page).getByRole("button", { name: t.editor.duplicate })).toBeVisible();
  });
});
