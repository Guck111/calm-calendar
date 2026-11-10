// The command menu on Ctrl+K: go to a date, create, search, switch the view.
import { test, expect, openApp, dialog } from "./fixtures";
import type { Page } from "@playwright/test";
import type { en } from "../../src/shared/i18n/en";

const open = async (page: Page, t: typeof en) => {
  await page.keyboard.press("Control+k");
  const menu = page.getByRole("dialog", { name: t.commands.title });
  await expect(menu.getByRole("combobox")).toBeFocused();
  return menu;
};

test("a view by its name", async ({ page, t }) => {
  await openApp(page);
  const menu = await open(page, t);
  await page.keyboard.type("mon");
  await expect(menu.getByRole("option").last()).toHaveText(t.toolbar.views.month);
  // "mon" is also Monday: the date comes first; ArrowUp from the first goes round to the last
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
  await expect(page.getByRole("tab", { name: t.toolbar.views.month })).toHaveAttribute("aria-selected", "true");
});

test("go to a date written in words", async ({ page, t }) => {
  await openApp(page);
  const menu = await open(page, t);
  await page.keyboard.type("nov 20");
  await expect(menu.getByRole("option").first()).toHaveText(t.commands.goTo("Fri 20 November"));
  await page.keyboard.press("Enter");
  await expect(page.locator("main header h2")).toHaveText("16 – 22 November 2026");
});

test("create an event from the phrase", async ({ page, t }) => {
  await openApp(page);
  const menu = await open(page, t);
  await page.keyboard.type("fri 1pm Lunch with Ola");
  await menu.getByRole("option", { name: t.commands.create("fri 1pm Lunch with Ola") }).click();
  const form = page.getByRole("dialog", { name: t.common.newEvent });
  await expect(form.getByPlaceholder(t.editor.titlePlaceholder)).toHaveValue("Lunch with Ola");
  await expect(form.getByLabel(t.editor.startDate)).toHaveValue("2026-11-13");
  await expect(form.getByLabel(t.editor.startTime)).toHaveValue("13:00");
});

test("search for the text", async ({ page, t }) => {
  await openApp(page);
  const menu = await open(page, t);
  await page.keyboard.type("sprint");
  await menu.getByRole("option", { name: t.commands.search("sprint") }).click();
  await expect(menu).toBeHidden();
  await expect(page.getByRole("textbox", { name: t.search.label })).toHaveValue("sprint");
  await expect(page.getByRole("option").filter({ hasText: "Sprint demo" })).toBeVisible();
});

test("Esc closes the menu; it opens from a text field too", async ({ page, t }) => {
  await openApp(page);
  const menu = await open(page, t);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await page.getByRole("textbox", { name: t.quick.label }).focus();
  await open(page, t);
  // Enter on the first command with an empty line: a new event
  await page.keyboard.press("Enter");
  await expect(dialog(page).getByPlaceholder(t.editor.titlePlaceholder)).toBeVisible();
});

test.describe("in Russian", () => {
  test.use({ lang: "ru" });
  test("«завтра» goes to tomorrow", async ({ page, t }) => {
    await openApp(page);
    const menu = await open(page, t);
    await page.keyboard.type("завтра");
    await expect(menu.getByRole("option").first()).toContainText(t.commands.goTo("").trim());
    await page.keyboard.press("Enter");
    await expect(page.getByRole("tab", { name: t.toolbar.views.week })).toHaveAttribute("aria-selected", "true");
  });
});
