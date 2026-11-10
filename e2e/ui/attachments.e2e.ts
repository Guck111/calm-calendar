// Attachments: Google Drive files in the card, attaching one by its link in the form.
// "Design sync" has the mock agenda doc attached.
import { test, expect, openApp, eventBlock, dialog } from "./fixtures";

test("the card lists the attached files", async ({ page, t }) => {
  await openApp(page);
  await eventBlock(page, "Design sync").click();
  const card = dialog(page);
  await expect(card).toContainText(t.editor.attachments);
  await expect(card.getByRole("button", { name: "Design sync agenda" })).toBeVisible();
});

test("attach a Drive file by its link, refuse other links, remove one", async ({ page, t }) => {
  await openApp(page);
  await eventBlock(page, "Design sync").click();
  await dialog(page).getByRole("button", { name: t.editor.edit }).click();
  const form = dialog(page);
  const field = form.getByRole("textbox", { name: t.editor.addAttachment });
  await field.fill("https://example.com/report.pdf");
  await field.press("Enter");
  await expect(form).toContainText(t.editor.badAttachment);
  await field.fill("https://docs.google.com/spreadsheets/d/1Budget_x/edit#gid=0");
  await field.press("Enter");
  await expect(field).toHaveValue("");
  await expect(form.getByRole("button", { name: t.editor.removeAttachment("Google Sheets") })).toBeVisible();
  await form.getByRole("button", { name: t.editor.removeAttachment("Design sync agenda") }).click();
  await form.getByRole("button", { name: t.common.save }).click();
  await expect(form).toBeHidden();

  await expect(async () => {
    await page.keyboard.press("Escape");
    await eventBlock(page, "Design sync").click();
    await expect(dialog(page).getByRole("button", { name: "Google Sheets" })).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 5000 });
  await expect(dialog(page).getByRole("button", { name: "Design sync agenda" })).toHaveCount(0);
});

test("moving an event keeps its attachments", async ({ page, t }) => {
  await openApp(page);
  const block = eventBlock(page, "Design sync");
  const box = (await block.boundingBox())!;
  const column = (await page.locator('main [class*="column"]').first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 5 + (column.height / 1440) * 60, { steps: 5 });
  await page.mouse.up();
  await expect(eventBlock(page, "Design sync")).toHaveAttribute("title", /^12:00–13:00 /);
  await eventBlock(page, "Design sync").click();
  await expect(dialog(page).getByRole("button", { name: "Design sync agenda" })).toBeVisible();
  void t;
});

test.describe("in Bengali", () => {
  test.use({ lang: "bn" });
  test("the field is translated", async ({ page, t }) => {
    await openApp(page);
    await page.locator("aside").getByRole("button", { name: t.sidebar.create }).click();
    await expect(dialog(page).getByRole("textbox", { name: t.editor.addAttachment })).toBeVisible();
  });
});
