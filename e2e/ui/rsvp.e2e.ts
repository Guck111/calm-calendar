// Answering an invitation in the card: Yes, No, Maybe. "Quarterly planning" (Tuesday 16:00) is
// organized by someone else and the work account is invited.
import { test, expect, openApp, eventBlock, dialog } from "./fixtures";

test("answer an invitation: the answer is kept in Google", async ({ page, t }) => {
  await openApp(page);
  await eventBlock(page, "Quarterly planning").click();
  const rsvp = dialog(page).getByRole("group", { name: t.editor.rsvpQuestion });
  await expect(rsvp).toBeVisible();
  const yes = rsvp.getByRole("button", { name: t.editor.rsvpYes });
  await expect(yes).toHaveAttribute("aria-pressed", "false");
  await yes.click();
  await expect(yes).toHaveAttribute("aria-pressed", "true");
  // my line in the guest list follows
  await expect(dialog(page).locator("li").filter({ hasText: "work@example.com" })).toContainText(t.editor.guestStatus.accepted);

  // after a reload of the events the answer is still there
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: t.toolbar.refresh }).click();
  await expect(async () => {
    await page.keyboard.press("Escape");
    await eventBlock(page, "Quarterly planning").click();
    await expect(dialog(page).getByRole("button", { name: t.editor.rsvpYes })).toHaveAttribute("aria-pressed", "true", {
      timeout: 500,
    });
  }).toPass({ timeout: 5000 });

  await dialog(page).getByRole("button", { name: t.editor.rsvpNo }).click();
  await expect(dialog(page).getByRole("button", { name: t.editor.rsvpNo })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog(page).getByRole("button", { name: t.editor.rsvpYes })).toHaveAttribute("aria-pressed", "false");
});

test("own events have no answer buttons", async ({ page, t }) => {
  await openApp(page);
  await eventBlock(page, "Dentist").click();
  await expect(dialog(page).getByRole("heading", { name: "Dentist" })).toBeVisible();
  await expect(dialog(page).getByRole("group", { name: t.editor.rsvpQuestion })).toHaveCount(0);
});

test.describe("in German", () => {
  test.use({ lang: "de" });
  test("the buttons are translated", async ({ page, t }) => {
    await openApp(page);
    await eventBlock(page, "Quarterly planning").click();
    await expect(dialog(page).getByRole("button", { name: t.editor.rsvpMaybe })).toBeVisible();
  });
});
