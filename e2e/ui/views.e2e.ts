// Month and Schedule views, week numbers, holidays, search.
import { test, expect, openApp, openSettings as openSection, eventBlock, dialog } from "./fixtures";
import type { Page } from "@playwright/test";
import type { en } from "../../src/shared/i18n/en";

const openSettings = (page: Page, t: typeof en) => openSection(page, t, "groupCalendar");

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

// "Now" is Wednesday 9:50: Monday's events and this morning's stand-up (9:30–9:45) are over
const opacity = (page: Page, selector: string, title: string) =>
  page.locator(selector).filter({ hasText: title }).first().evaluate((el) => Number(getComputedStyle(el).opacity));

test("past events are dimmed in Week, Month and Schedule", async ({ page }) => {
  await openApp(page);
  expect(await opacity(page, "main button[title]", "Brunch with Anna")).toBeLessThan(1);
  expect(await opacity(page, "main button[title]", "Design sync")).toBe(1);

  await page.keyboard.press("m");
  expect(await opacity(page, "main button[title]", "Brunch with Anna")).toBeLessThan(1);
  expect(await opacity(page, "main button[title]", "Dentist")).toBe(1);

  await page.keyboard.press("a");
  expect(await opacity(page, "main li button", "Team standup")).toBeLessThan(1);
  expect(await opacity(page, "main li button", "Design sync")).toBe(1);
});

test("Schedule: a call link in the place reads as the service", async ({ page }) => {
  await openApp(page);
  await page.keyboard.press("a");
  const row = page.locator("main li").filter({ hasText: "Sprint demo" });
  await expect(row).toContainText("Zoom");
  await expect(row).not.toContainText("zoom.us/j/");
});

// The longest labels: Russian, the Schedule tab is the widest. The title is the main "where am I"
test.describe("nothing important is cut off", () => {
  test.use({ lang: "ru" });

  test("the period title fits in a 1280 px window", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openApp(page);
    for (const key of ["w", "a"]) {
      await page.keyboard.press(key);
      const title = page.locator("main header > h2");
      expect(await title.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
      // and the toolbar itself does not spill over
      expect(await page.locator("main header").evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    }
  });

  test("a narrower window: the search folds into a magnifier, the buttons keep their size", async ({ page, t }) => {
    await page.setViewportSize({ width: 1000, height: 700 });
    await openApp(page);
    const header = page.locator("main header");
    const search = header.getByRole("combobox").or(header.getByRole("searchbox")).or(header.locator("input")).first();
    expect((await search.boundingBox())!.width).toBeLessThan(40);
    for (const name of [t.toolbar.freeSlots, t.toolbar.refresh, t.common.settings]) {
      expect((await header.getByRole("button", { name }).boundingBox())!.width).toBeGreaterThanOrEqual(30);
    }
    await page.keyboard.press("Control+f");
    await expect(search).toBeFocused();
    await expect.poll(async () => (await search.boundingBox())!.width).toBeGreaterThan(150);
    expect(await header.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  });

  test("the widget cuts the title, never the time left", async ({ page }) => {
    await page.setViewportSize({ width: 300, height: 600 });
    await page.goto("/?window=widget");
    await expect(page.locator("ul li").first()).toBeVisible();
    const time = page.locator('[class*="countdownText"]');
    await expect(time).toBeVisible();
    expect(await time.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    const box = await time.boundingBox();
    const line = await page.locator('[class*="countdownLine"]').boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(line!.x + line!.width + 0.5);
  });
});
