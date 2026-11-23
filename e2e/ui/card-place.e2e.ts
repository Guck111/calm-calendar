// The event card stands next to the event it was opened from; the form stays in the middle of the window.
import type { Locator, Page } from "@playwright/test";
import { test, expect, openApp, eventBlock, dialog } from "./fixtures";

type Box = { x: number; y: number; width: number; height: number };

const boxOf = async (locator: Locator): Promise<Box> => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not on screen");
  return box;
};

const right = (b: Box) => b.x + b.width;
const bottom = (b: Box) => b.y + b.height;
const overlap = (a: Box, b: Box) => a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a);

const expectInsideWindow = (page: Page, card: Box) => {
  const size = page.viewportSize()!;
  expect(card.x).toBeGreaterThanOrEqual(0);
  expect(card.y).toBeGreaterThanOrEqual(0);
  expect(right(card)).toBeLessThanOrEqual(size.width);
  expect(bottom(card)).toBeLessThanOrEqual(size.height);
};

/** opens the card of an event and waits until it has left the middle of the window */
const openCard = async (page: Page, title: string) => {
  const block = eventBlock(page, title);
  const blockBox = await boxOf(block);
  await block.click();
  const card = dialog(page);
  await expect(card.getByRole("heading", { name: title })).toBeVisible();
  await expect.poll(async () => overlap(await boxOf(card), blockBox)).toBe(false);
  return { block: blockBox, card: await boxOf(card) };
};

test("the card opens right after its event and does not cover it", async ({ page }) => {
  await openApp(page);
  const { block, card } = await openCard(page, "Dentist");
  expect(card.x - right(block)).toBeGreaterThanOrEqual(0);
  expect(card.x - right(block)).toBeLessThanOrEqual(12);
  expectInsideWindow(page, card);
});

test("an event in the last column: the card stands before it", async ({ page }) => {
  await openApp(page);
  const { block, card } = await openCard(page, "Hike");
  expect(block.x - right(card)).toBeGreaterThanOrEqual(0);
  expect(block.x - right(card)).toBeLessThanOrEqual(12);
  expectInsideWindow(page, card);
});

test("an event at the bottom of the window: the card moves up to stay in view", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 620 });
  await openApp(page);
  const block = eventBlock(page, "Dinner with parents");
  await block.scrollIntoViewIfNeeded();
  const { card } = await openCard(page, "Dinner with parents");
  expectInsideWindow(page, card);
});

test("Month: the card stands next to the event too", async ({ page, t }) => {
  await openApp(page);
  await page.getByRole("tab", { name: t.toolbar.views.month }).click();
  const chip = page.locator('main button[data-event-key][title="Dentist"]');
  const chipBox = await boxOf(chip);
  await chip.click();
  const card = dialog(page);
  await expect(card.getByRole("heading", { name: "Dentist" })).toBeVisible();
  await expect.poll(async () => overlap(await boxOf(card), chipBox)).toBe(false);
  expectInsideWindow(page, await boxOf(card));
});

test("Edit moves to the form in the middle of the window", async ({ page, t }) => {
  await openApp(page);
  await openCard(page, "Dentist");
  await dialog(page).getByRole("button", { name: t.editor.edit }).click();
  const form = dialog(page);
  await expect(form.getByPlaceholder(t.editor.titlePlaceholder)).toBeVisible();
  const size = page.viewportSize()!;
  await expect
    .poll(async () => {
      const box = await boxOf(form);
      return Math.abs(box.x + box.width / 2 - size.width / 2);
    })
    .toBeLessThanOrEqual(1);
});

test("a click outside the card closes it", async ({ page }) => {
  await openApp(page);
  const { card } = await openCard(page, "Dentist");
  await page.mouse.click(card.x + card.width / 2, bottom(card) + 40 < page.viewportSize()!.height ? bottom(card) + 40 : card.y - 40);
  await expect(dialog(page)).toBeHidden();
});

test.describe("right to left", () => {
  test.use({ lang: "ar" });

  test("the card stands on the other side of the event", async ({ page }) => {
    await openApp(page);
    const { block, card } = await openCard(page, "Dentist");
    expect(block.x - right(card)).toBeGreaterThanOrEqual(0);
    expect(block.x - right(card)).toBeLessThanOrEqual(12);
    expectInsideWindow(page, card);
  });
});
