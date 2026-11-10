// A color for a single event: picked in the form, shown in Week, Month and Schedule, reset to the calendar color.
import { test, expect, openApp, eventBlock, dialog } from "./fixtures";
import type { Locator } from "@playwright/test";

const color = (el: Locator) => el.evaluate((node) => getComputedStyle(node).getPropertyValue("--c").trim());

test("pick Tomato for one event, then go back to the calendar color", async ({ page, t }) => {
  await openApp(page);
  const block = eventBlock(page, "Dentist");
  const calendarColor = await color(block);
  await block.click();
  await dialog(page).getByRole("button", { name: t.editor.edit }).click();
  const colors = dialog(page).getByRole("radiogroup", { name: t.editor.color });
  await expect(colors.getByRole("radio", { name: t.editor.calendarColor })).toHaveAttribute("aria-checked", "true");
  await colors.getByRole("radio", { name: t.editor.colorNames["11"] }).click();
  await dialog(page).getByRole("button", { name: t.common.save }).click();
  await expect(dialog(page)).toBeHidden();
  await expect.poll(() => color(eventBlock(page, "Dentist"))).toBe("#d50000");
  // the rest of the calendar keeps its color
  expect(await color(eventBlock(page, "Spanish class"))).toBe(calendarColor);

  await page.keyboard.press("m");
  expect(await color(page.locator("main").getByTitle("Dentist"))).toBe("#d50000");
  await page.keyboard.press("a");
  expect(await color(page.locator("main li button").filter({ hasText: "Dentist" }))).toBe("#d50000");

  await page.keyboard.press("w");
  await eventBlock(page, "Dentist").click();
  await dialog(page).getByRole("button", { name: t.editor.edit }).click();
  await expect(colors.getByRole("radio", { name: t.editor.colorNames["11"] })).toHaveAttribute("aria-checked", "true");
  await colors.getByRole("radio", { name: t.editor.calendarColor }).click();
  await dialog(page).getByRole("button", { name: t.common.save }).click();
  await expect.poll(() => color(eventBlock(page, "Dentist"))).toBe(calendarColor);
});

test("a new event can get a color right away", async ({ page, t }) => {
  await openApp(page);
  await page.locator("aside").getByRole("button", { name: t.sidebar.create }).click();
  const form = dialog(page);
  await form.getByPlaceholder(t.editor.titlePlaceholder).fill("Painting");
  await form.getByLabel(t.editor.startDate).fill("2026-11-12");
  await form.getByLabel(t.editor.startTime).fill("08:00");
  await form.getByLabel(t.editor.endDate).fill("2026-11-12");
  await form.getByLabel(t.editor.endTime).fill("09:00");
  await form.getByRole("radio", { name: t.editor.colorNames["2"] }).click();
  await form.getByRole("button", { name: t.common.save }).click();
  await expect.poll(() => color(eventBlock(page, "Painting"))).toBe("#33b679");
});

test.describe("in Japanese", () => {
  test.use({ lang: "ja" });
  test("color names are translated", async ({ page, t }) => {
    await openApp(page);
    await page.locator("aside").getByRole("button", { name: t.sidebar.create }).click();
    await expect(dialog(page).getByRole("radio", { name: t.editor.colorNames["7"] })).toBeVisible();
  });
});
