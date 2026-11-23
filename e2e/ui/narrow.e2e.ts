// A narrow window: the side panel folds away and the four view tabs become one menu, so the toolbar fits
// and the period title is never cut. In a wide window the side panel is hidden by its button.
import type { Page } from "@playwright/test";
import { test, expect, openApp, dialog } from "./fixtures";

const overflow = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => el.scrollWidth - el.clientWidth);

const expectToolbarFits = async (page: Page) => {
  for (const key of ["d", "w", "m", "a"]) {
    await page.keyboard.press(key);
    expect(await overflow(page, "main header > h2")).toBeLessThanOrEqual(0);
    expect(await overflow(page, "main header")).toBeLessThanOrEqual(0);
  }
};

// The longest labels are Russian
test.describe("narrow window", () => {
  test.use({ lang: "ru" });

  test("760 px: the toolbar fits, the period title is whole, the side panel is folded", async ({ page }) => {
    await page.setViewportSize({ width: 760, height: 600 });
    await openApp(page);
    await expect(page.locator("aside")).toBeHidden();
    await expectToolbarFits(page);
  });

  test("760 px: the button pulls the side panel out over the calendar; Esc or a click outside folds it", async ({
    page,
    t,
  }) => {
    await page.setViewportSize({ width: 760, height: 600 });
    await openApp(page);
    const main = page.locator("main");
    const widthBefore = (await main.boundingBox())!.width;
    const toggle = page.getByRole("button", { name: t.toolbar.sidebar });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await toggle.click();
    const panel = page.locator("aside");
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("button", { name: t.sidebar.create })).toBeVisible();
    expect((await main.boundingBox())!.width).toBe(widthBefore);

    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();

    await toggle.click();
    await expect(panel).toBeVisible();
    await page.mouse.click(700, 400);
    await expect(panel).toBeHidden();
  });

  test("760 px: N pulls the side panel out with the cursor in quick add", async ({ page, t }) => {
    await page.setViewportSize({ width: 760, height: 600 });
    await openApp(page);
    await page.keyboard.press("n");
    await expect(page.getByRole("textbox", { name: t.quick.label })).toBeFocused();
  });

  test("1000 px: the period title is whole and the views are one menu", async ({ page, t }) => {
    await page.setViewportSize({ width: 1000, height: 700 });
    await openApp(page);
    await expect(page.locator("aside")).toBeVisible();
    await expect(page.getByRole("tablist")).toBeHidden();
    await expectToolbarFits(page);

    await page.keyboard.press("w");
    const menuButton = page.locator("main header").getByRole("button", { name: new RegExp(`^${t.toolbar.view}`) });
    await expect(menuButton).toContainText(t.toolbar.views.week);
    await menuButton.click();
    const menu = page.getByRole("menu", { name: t.toolbar.view });
    await expect(menu.getByRole("menuitemradio")).toHaveCount(4);
    await expect(menu.getByRole("menuitemradio", { name: new RegExp(t.toolbar.views.week) })).toHaveAttribute("aria-checked", "true");
    await menu.getByRole("menuitemradio", { name: new RegExp(t.toolbar.views.month) }).click();
    await expect(menu).toBeHidden();
    await expect(menuButton).toContainText(t.toolbar.views.month);
    await expect(page.locator('main [class*="dayHead"]')).toHaveCount(0);
  });

  test("1000 px: the view menu works from the keyboard", async ({ page, t }) => {
    await page.setViewportSize({ width: 1000, height: 700 });
    await openApp(page);
    const menuButton = page.locator("main header").getByRole("button", { name: new RegExp(`^${t.toolbar.view}`) });
    await menuButton.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu", { name: t.toolbar.view });
    // the cursor starts on the current view (Week); one step down is Month
    await expect(menu.getByRole("menuitemradio", { name: new RegExp(t.toolbar.views.week) })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(menu).toBeHidden();
    await expect(menuButton).toContainText(t.toolbar.views.month);
    await expect(menuButton).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(menuButton).toContainText(t.toolbar.views.month);
  });
});

// the user's case: a wide window, but with the side panel the calendar itself is narrow
test.describe("the toolbar follows the calendar panel, not the window", () => {
  test.use({ lang: "ru" });

  test("1320 px: with the side panel the views are a menu, without it they are tabs", async ({ page, t }) => {
    await page.setViewportSize({ width: 1320, height: 800 });
    await openApp(page);
    await expect(page.locator("aside")).toBeVisible();
    await expect(page.getByRole("tablist")).toBeHidden();
    await expectToolbarFits(page);

    await page.getByRole("button", { name: t.toolbar.sidebar }).click();
    await expect(page.locator("aside")).toBeHidden();
    await expect(page.getByRole("tablist")).toBeVisible();
    await expectToolbarFits(page);
  });
});

test("wide window: the button hides the side panel, the choice survives a restart, + creates", async ({ page, t }) => {
  await openApp(page);
  await expect(page.getByRole("tablist")).toBeVisible();
  const main = page.locator("main");
  const widthBefore = (await main.boundingBox())!.width;
  const toggle = page.getByRole("button", { name: t.toolbar.sidebar });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const plus = page.locator("main header").getByRole("button", { name: t.common.newEvent });
  await expect(plus).toHaveCount(0);

  await toggle.click();
  await expect(page.locator("aside")).toBeHidden();
  expect((await main.boundingBox())!.width).toBeGreaterThan(widthBefore + 200);

  await plus.click();
  await expect(dialog(page).getByPlaceholder(t.editor.titlePlaceholder)).toBeVisible();
  await page.keyboard.press("Escape");

  await page.reload();
  await expect(page.locator("main header")).toBeVisible();
  await expect(page.locator("aside")).toBeHidden();

  // quick add lives in the side panel: N brings it back
  await page.keyboard.press("n");
  await expect(page.getByRole("textbox", { name: t.quick.label })).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
});
