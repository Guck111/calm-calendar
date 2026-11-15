// The event form: rare fields wait under "More", the buttons stay in view, notes come right after the place.
// "Design sync" has a Drive file attached in the mock data.
import { test, expect, openApp, eventBlock, dialog, moreButton } from "./fixtures";

test("a new event: time zone, travel time, color and attachments wait under More", async ({ page, t }) => {
  await openApp(page);
  await page.locator("aside").getByRole("button", { name: t.sidebar.create }).click();
  const form = dialog(page);
  const more = moreButton(form, t);
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(form.getByLabel(t.editor.timeZone)).toHaveCount(0);
  await expect(form.getByLabel(t.editor.travel)).toHaveCount(0);
  await expect(form.getByRole("radiogroup", { name: t.editor.color })).toHaveCount(0);

  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(form.getByLabel(t.editor.timeZone)).toBeVisible();
  await expect(form.getByLabel(t.editor.travel)).toBeVisible();
  await expect(form.getByRole("radiogroup", { name: t.editor.color })).toBeVisible();
  await expect(form.getByRole("textbox", { name: t.editor.addAttachment })).toBeVisible();
});

test("an event that uses one of them opens with More expanded", async ({ page, t }) => {
  await openApp(page);
  await eventBlock(page, "Design sync").click();
  await dialog(page).getByRole("button", { name: t.editor.edit }).click();
  const form = dialog(page);
  await expect(moreButton(form, t)).toHaveAttribute("aria-expanded", "true");
  await expect(form.getByRole("textbox", { name: t.editor.addAttachment })).toBeVisible();
});

test("Save stays in view in a low window, also with everything expanded", async ({ page, t }) => {
  await page.setViewportSize({ width: 900, height: 520 });
  await openApp(page);
  await eventBlock(page, "Design sync").click();
  await dialog(page).getByRole("button", { name: t.editor.edit }).click();
  const form = dialog(page);
  await expect(form.getByRole("button", { name: t.common.save })).toBeInViewport();
  await expect(form.getByRole("button", { name: t.common.cancel })).toBeInViewport();
});

test("notes come right after the place, with a hint", async ({ page, t }) => {
  await openApp(page);
  await page.locator("aside").getByRole("button", { name: t.sidebar.create }).click();
  const form = dialog(page);
  const place = await form.getByLabel(t.common.location).boundingBox();
  const notes = form.getByLabel(t.common.description);
  await expect(notes).toHaveAttribute("placeholder", t.editor.descriptionHint);
  const notesBox = await notes.boundingBox();
  const guests = await form.getByRole("textbox", { name: t.editor.addGuest }).boundingBox();
  expect(place && notesBox && guests).toBeTruthy();
  expect(notesBox!.y).toBeGreaterThan(place!.y);
  expect(notesBox!.y).toBeLessThan(guests!.y);
});
