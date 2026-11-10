// Month and Schedule views, week numbers, holidays, search.
import { test, expect, openApp, eventBlock, dialog } from "./fixtures";
import type { Page } from "@playwright/test";
import type { en } from "../../src/shared/i18n/en";

const openSettings = async (page: Page, t: typeof en) => {
  await page.getByRole("button", { name: t.common.settings }).click();
  return page.getByRole("dialog", { name: t.common.settings });
};

test("view switch: buttons and keys D, W, M, A", async ({ page, t }) => {
  await openApp(page);
  const tab = (id: keyof typeof t.toolbar.views) => page.getByRole("tab", { name: t.toolbar.views[id] });
  await expect(tab("week")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("d");
  await expect(tab("day")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('main [class*="column"]')).toHaveCount(1);
  await page.keyboard.press("m");
  await expect(tab("month")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("a");
  await expect(tab("agenda")).toHaveAttribute("aria-selected", "true");
  await tab("week").click();
  await expect(page.locator('main [class*="column"]')).toHaveCount(7);
  // the view is remembered
  await page.reload();
  await expect(tab("week")).toHaveAttribute("aria-selected", "true");
});

test("arrows and Today move through weeks", async ({ page, t }) => {
  await openApp(page);
  const title = page.locator("main header h2");
  await expect(title).toHaveText("9 – 15 November 2026");
  await page.keyboard.press("ArrowRight");
  await expect(title).toHaveText("16 – 22 November 2026");
  await page.getByRole("button", { name: t.toolbar.back }).click();
  await page.getByRole("button", { name: t.toolbar.back }).click();
  await expect(title).toHaveText("2 – 8 November 2026");
  await page.keyboard.press("t");
  await expect(title).toHaveText("9 – 15 November 2026");
});

test("month view: events, \"N more\" and a click on a day", async ({ page, t }) => {
  await openApp(page);
  await page.keyboard.press("m");
  const month = page.locator("main");
  await expect(month.getByTitle("Mom's birthday")).toBeVisible();
  await expect(month.getByTitle("Dentist")).toBeVisible();
  // Friday 13: the birthday, Morning run, Team standup, 1:1 with Sam, Dinner → two more than fit
  await expect(month.getByText(t.month.more(2))).toBeVisible();
  await month.getByTitle(t.common.openDay).filter({ hasText: /^13$/ }).first().click();
  await expect(page.getByRole("tab", { name: t.toolbar.views.day })).toHaveAttribute("aria-selected", "true");
  await expect(eventBlock(page, "1:1 with Sam")).toBeVisible();
});

test("schedule: four weeks by day, days without events skipped", async ({ page, t }) => {
  await openApp(page);
  await page.keyboard.press("a");
  const days = page.locator('main section button[title="' + t.common.openDay + '"]');
  await expect(days.first()).toHaveText("Wed 11 November");
  await expect(page.locator("main section").first()).toContainText("Dentist");
  // weekdays have the stand-up; weekends of the next weeks are empty
  await expect(days.filter({ hasText: "Fri 20 November" })).toHaveCount(1);
  await expect(days.filter({ hasText: "Sat 21 November" })).toHaveCount(0);
  await expect(days.last()).toHaveText("Tue 8 December");
  await page.locator("main li button").filter({ hasText: "Hiring panel" }).click();
  await expect(dialog(page).getByRole("heading", { name: "Hiring panel" })).toBeVisible();
});

test("week numbers in the title, the mini month and Month", async ({ page, t }) => {
  await openApp(page);
  const title = page.locator("main header h2");
  await expect(title).not.toContainText(t.time.week("46"));
  const settings = await openSettings(page, t);
  await settings.getByRole("switch", { name: t.settings.weekNumbers }).check();
  await settings.getByRole("button", { name: t.common.close }).click();
  await expect(title).toContainText(t.time.week("46"));
  await expect(page.locator('aside [class*="weekNo"]').filter({ hasText: /^46$/ })).toBeVisible();
  await page.keyboard.press("m");
  await expect(page.locator('main [class*="weekNo"]').filter({ hasText: /^46$/ })).toBeVisible();
  // the setting is remembered
  await page.reload();
  await expect(page.locator('main [class*="weekNo"]').first()).toBeVisible();
});

test("holidays: a country's calendar as a separate group, read only", async ({ page, t }) => {
  await openApp(page);
  const settings = await openSettings(page, t);
  await settings.getByLabel(t.settings.holidays).selectOption("PL");
  await settings.getByRole("button", { name: t.common.close }).click();
  const group = page.locator("aside").getByRole("group", { name: t.sidebar.holidays });
  await expect(group).toContainText("Poland");
  // the mock holiday calendar has a holiday on the 11th and the 25th of each month
  const holiday = page.locator("main").getByRole("button", { name: /en\.polish/ });
  await expect(holiday).toBeVisible();
  await holiday.click();
  await expect(dialog(page)).toContainText(t.editor.readOnly);
  await expect(dialog(page).getByRole("button", { name: t.editor.edit })).toHaveCount(0);
  await page.keyboard.press("Escape");
  // "Don't show" removes the group
  const again = await openSettings(page, t);
  await again.getByLabel(t.settings.holidays).selectOption("");
  await again.getByRole("button", { name: t.common.close }).click();
  await expect(group).toHaveCount(0);
});

test("search: Ctrl+F, results, a click opens the event on its day", async ({ page, t }) => {
  await openApp(page);
  await page.keyboard.press("Control+f");
  const field = page.getByRole("textbox", { name: t.search.label });
  await expect(field).toBeFocused();
  await field.fill("sprint");
  const result = page.getByRole("option").filter({ hasText: "Sprint demo" });
  await expect(result).toBeVisible();
  await result.click();
  await expect(dialog(page).getByRole("heading", { name: "Sprint demo" })).toBeVisible();
});

test("hiding a calendar hides its events", async ({ page }) => {
  await openApp(page);
  await expect(eventBlock(page, "Yoga")).toBeVisible();
  await page.locator("aside label[title=\"Fitness\"]").click();
  await expect(page.locator("aside label[title=\"Fitness\"] input")).not.toBeChecked();
  await expect(eventBlock(page, "Yoga")).toHaveCount(0);
  await page.reload();
  await expect(eventBlock(page, "Dentist")).toBeVisible();
  await expect(eventBlock(page, "Yoga")).toHaveCount(0);
});
