// Recurring events: "this event" and "this and following" when saving and deleting, a new series from the form.
// "Team standup" repeats every weekday at 9:30 from Monday two weeks ago (work account).
import { test, expect, openApp, dialog, blocksByDay, blockOn } from "./fixtures";
import type { Page } from "@playwright/test";

const standupDays = async (page: Page) => {
  const days = await blocksByDay(page);
  return Object.entries(days)
    .filter(([, titles]) => titles.includes("Team standup"))
    .map(([day]) => day);
};

test("edit one occurrence: only that day changes", async ({ page, t }) => {
  await openApp(page);
  await (await blockOn(page, "Team standup", 12)).click();
  await dialog(page).getByRole("button", { name: t.editor.edit }).click();
  await dialog(page).getByPlaceholder(t.editor.titlePlaceholder).fill("Standup with guests");
  await dialog(page).getByRole("button", { name: t.common.save }).click();
  const scope = dialog(page).getByRole("group", { name: t.scope.saveTitle });
  await expect(scope).toBeVisible();
  await scope.getByRole("button", { name: t.scope.this, exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(await blockOn(page, "Standup with guests", 12)).toBeVisible();
  expect(await standupDays(page)).toEqual(["9", "10", "11", "13"]);
});

test("change the time of this and following: the series splits", async ({ page, t }) => {
  await openApp(page);
  await (await blockOn(page, "Team standup", 12)).click();
  await dialog(page).getByRole("button", { name: t.editor.edit }).click();
  await dialog(page).getByLabel(t.editor.startTime).fill("10:30");
  await dialog(page).getByLabel(t.editor.endTime).fill("10:45");
  await dialog(page).getByRole("button", { name: t.common.save }).click();
  await dialog(page).getByRole("button", { name: t.scope.following }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(await blockOn(page, "Team standup", 12)).toHaveAttribute("title", /^10:30–10:45 /);
  await expect(await blockOn(page, "Team standup", 13)).toHaveAttribute("title", /^10:30–10:45 /);
  await expect(await blockOn(page, "Team standup", 11)).toHaveAttribute("title", /^09:30–09:45 /);
  // next week the new series goes on at the new time
  await page.getByRole("button", { name: t.toolbar.forward }).click();
  await expect(await blockOn(page, "Team standup", 16)).toHaveAttribute("title", /^10:30–10:45 /);
});

test("delete this and following: the series ends before that day", async ({ page, t }) => {
  await openApp(page);
  await (await blockOn(page, "Team standup", 12)).click();
  // a recurring event asks about the scope instead of "Delete?"
  await dialog(page).getByRole("button", { name: t.editor.delete }).click();
  const scope = dialog(page).getByRole("group", { name: t.scope.deleteTitle });
  await scope.getByRole("button", { name: t.scope.following }).click();
  await expect(dialog(page)).toBeHidden();
  await expect.poll(() => standupDays(page)).toEqual(["9", "10", "11"]);
  await page.getByRole("button", { name: t.toolbar.forward }).click();
  await expect(page.locator("main button[title]").filter({ hasText: "Team standup" })).toHaveCount(0);
});

test("delete one occurrence", async ({ page, t }) => {
  await openApp(page);
  await (await blockOn(page, "Team standup", 10)).click();
  await dialog(page).getByRole("button", { name: t.editor.delete }).click();
  await dialog(page).getByRole("button", { name: t.scope.this, exact: true }).click();
  await expect.poll(() => standupDays(page)).toEqual(["9", "11", "12", "13"]);
});

test("a new weekly event from the form repeats next week", async ({ page, t }) => {
  await openApp(page);
  await page.locator("aside").getByRole("button", { name: t.sidebar.create }).click();
  const form = dialog(page);
  await form.getByPlaceholder(t.editor.titlePlaceholder).fill("Piano lesson");
  await form.getByLabel(t.editor.startDate).fill("2026-11-12");
  await form.getByLabel(t.editor.startTime).fill("17:00");
  await form.getByLabel(t.editor.endDate).fill("2026-11-12");
  await form.getByLabel(t.editor.endTime).fill("18:00");
  await form.getByLabel(t.repeat.label).selectOption("weekly");
  await form.getByRole("button", { name: t.common.save }).click();
  await expect(form).toBeHidden();
  await expect(await blockOn(page, "Piano lesson", 12)).toBeVisible();
  await page.getByRole("button", { name: t.toolbar.forward }).click();
  await expect(await blockOn(page, "Piano lesson", 19)).toBeVisible();
  // the card describes the rule
  await (await blockOn(page, "Piano lesson", 19)).click();
  await expect(dialog(page)).toContainText(t.repeat.every("WEEKLY", 1));
});

test("custom rule: every 2 weeks, 3 times", async ({ page, t }) => {
  await openApp(page);
  await page.locator("aside").getByRole("button", { name: t.sidebar.create }).click();
  const form = dialog(page);
  await form.getByPlaceholder(t.editor.titlePlaceholder).fill("Book club");
  await form.getByLabel(t.editor.startDate).fill("2026-11-10");
  await form.getByLabel(t.editor.startTime).fill("20:00");
  await form.getByLabel(t.editor.endDate).fill("2026-11-10");
  await form.getByLabel(t.editor.endTime).fill("21:00");
  await form.getByLabel(t.repeat.label).first().selectOption("custom");
  await form.getByLabel(t.repeat.interval).fill("2");
  await form.getByRole("radio", { name: t.repeat.count }).check();
  await form.getByRole("spinbutton", { name: t.repeat.count }).fill("3");
  await expect(form.getByLabel(t.repeat.label).first()).toContainText("Every 2 weeks");
  await form.getByRole("button", { name: t.common.save }).click();
  await expect(form).toBeHidden();
  await expect(await blockOn(page, "Book club", 10)).toBeVisible();
  const weeks: number[] = [];
  for (let i = 0; i < 6; i++) {
    // the stand-up is there every week: the week has loaded
    await expect(page.locator("main button[title]").filter({ hasText: "Team standup" }).first()).toBeVisible();
    weeks.push(await page.locator("main button[title]").filter({ hasText: "Book club" }).count());
    await page.getByRole("button", { name: t.toolbar.forward }).click();
  }
  expect(weeks).toEqual([1, 0, 1, 0, 1, 0]);
});
