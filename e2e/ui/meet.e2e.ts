// "Add Google Meet": a switch in the form, Google creates the call, the card gets Join.
import { test, expect, openApp, eventBlock, dialog, blockOn } from "./fixtures";

test("a new event with Google Meet gets Join in the card", async ({ page, t }) => {
  await openApp(page);
  await page.locator("aside").getByRole("button", { name: t.sidebar.create }).click();
  const form = dialog(page);
  await form.getByPlaceholder(t.editor.titlePlaceholder).fill("Weekly sync");
  await form.getByLabel(t.editor.startDate).fill("2026-11-12");
  await form.getByLabel(t.editor.startTime).fill("12:00");
  await form.getByLabel(t.editor.endDate).fill("2026-11-12");
  await form.getByLabel(t.editor.endTime).fill("12:30");
  await form.getByRole("checkbox", { name: t.editor.addMeet }).check();
  await form.getByRole("button", { name: t.common.save }).click();
  await expect(form).toBeHidden();
  await (await blockOn(page, "Weekly sync", 12)).click();
  await expect(dialog(page).getByRole("button", { name: new RegExp(t.meeting.join) })).toContainText("Google Meet");
});

test("Meet can be added to an event without a call", async ({ page, t }) => {
  await openApp(page);
  await eventBlock(page, "Dentist").click();
  await expect(dialog(page).getByRole("button", { name: new RegExp(t.meeting.join) })).toHaveCount(0);
  await dialog(page).getByRole("button", { name: t.editor.edit }).click();
  await dialog(page).getByRole("checkbox", { name: t.editor.addMeet }).check();
  await dialog(page).getByRole("button", { name: t.common.save }).click();
  await expect(dialog(page)).toBeHidden();
  // the card shows the event as reloaded from Google after saving
  await expect(async () => {
    await page.keyboard.press("Escape");
    await eventBlock(page, "Dentist").click();
    await expect(dialog(page).getByRole("button", { name: new RegExp(t.meeting.join) })).toContainText("Google Meet", {
      timeout: 500,
    });
  }).toPass({ timeout: 5000 });
});

test("an event that already has a call has no switch", async ({ page, t }) => {
  await openApp(page);
  await eventBlock(page, "Design sync").click();
  await dialog(page).getByRole("button", { name: t.editor.edit }).click();
  await expect(dialog(page).getByPlaceholder(t.editor.titlePlaceholder)).toHaveValue("Design sync");
  await expect(dialog(page).getByRole("checkbox", { name: t.editor.addMeet })).toHaveCount(0);
});

test.describe("in Russian", () => {
  test.use({ lang: "ru" });
  test("the switch is translated", async ({ page, t }) => {
    await openApp(page);
    await page.locator("aside").getByRole("button", { name: t.sidebar.create }).click();
    await expect(dialog(page).getByRole("checkbox", { name: t.editor.addMeet })).not.toBeChecked();
  });
});
