// The event card and the form, drag and resize in Week.
import { test, expect, openApp, eventBlock, dialog, rangeText, dayOfBlock, dayNumber, escapeRe } from "./fixtures";
import type { Page } from "@playwright/test";

const startsAt = async (page: Page, title: string, day: number, from: [number, number], to: [number, number]) => {
  const block = eventBlock(page, title);
  await expect(block).toHaveAttribute("title", new RegExp(`^${escapeRe(await rangeText(page, day, from, to))} `));
  expect(await dayOfBlock(page, block)).toBe(await dayNumber(page, day));
};

test.describe("event card", () => {
  test("shows the time, calendar, location and overlap; Esc closes it", async ({ page, t }) => {
    await openApp(page);
    await eventBlock(page, "Dentist").click();
    const card = dialog(page);
    await expect(card.getByRole("heading", { name: "Dentist" })).toBeVisible();
    await expect(card).toContainText("Main St Clinic");
    await expect(card).toContainText("Personal");
    // two accounts: the account is shown next to the calendar
    await expect(card).toContainText("me@example.com");
    // the work account has "Hiring panel" at the same time
    await expect(card).toContainText(t.accounts.conflict("").trim());
    await expect(card).toContainText("Hiring panel");
    await page.keyboard.press("Escape");
    await expect(card).toBeHidden();
  });

  test("a call has Join with the provider", async ({ page, t }) => {
    await openApp(page);
    await eventBlock(page, "Design sync").click();
    await expect(dialog(page).getByRole("button", { name: new RegExp(t.meeting.join) })).toContainText("Zoom");
  });

  test("edit: the new title and location are saved", async ({ page, t }) => {
    await openApp(page);
    await eventBlock(page, "Dentist").click();
    await dialog(page).getByRole("button", { name: t.editor.edit }).click();
    const form = dialog(page);
    await form.getByPlaceholder(t.editor.titlePlaceholder).fill("Dentist check-up");
    await form.getByLabel(t.common.location).fill("Oak St Clinic");
    await form.getByRole("button", { name: t.common.save }).click();
    await expect(form).toBeHidden();
    await startsAt(page, "Dentist check-up", 11, [16, 0], [16, 45]);
    await eventBlock(page, "Dentist check-up").click();
    await expect(dialog(page)).toContainText("Oak St Clinic");
  });

  test("delete asks once more", async ({ page, t }) => {
    await openApp(page);
    await eventBlock(page, "Spanish class").click();
    const del = dialog(page).getByRole("button", { name: t.editor.delete });
    await del.click();
    await expect(dialog(page).getByRole("button", { name: t.editor.confirmDelete })).toBeVisible();
    await dialog(page).getByRole("button", { name: t.editor.confirmDelete }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(eventBlock(page, "Spanish class")).toHaveCount(0);
  });
});

test.describe("event form", () => {
  test("Create opens an empty form; Save adds the event", async ({ page, t }) => {
    await openApp(page);
    await page.locator("aside").getByRole("button", { name: t.sidebar.create }).click();
    const form = page.getByRole("dialog", { name: t.common.newEvent });
    await form.getByPlaceholder(t.editor.titlePlaceholder).fill("Plan the trip");
    await form.getByLabel(t.editor.startDate).fill("2026-11-12");
    await form.getByLabel(t.editor.startTime).fill("08:00");
    await form.getByLabel(t.editor.endDate).fill("2026-11-12");
    await form.getByLabel(t.editor.endTime).fill("08:30");
    await form.getByLabel(t.common.calendar).selectOption({ label: "Family" });
    await form.getByLabel(t.common.description).fill("Tickets and hotel");
    await form.getByRole("button", { name: t.common.save }).click();
    await expect(form).toBeHidden();
    await startsAt(page, "Plan the trip", 12, [8, 0], [8, 30]);
    await eventBlock(page, "Plan the trip").click();
    await expect(dialog(page)).toContainText("Family");
    await expect(dialog(page)).toContainText("Tickets and hotel");
  });

  test("a click on an empty half hour opens the form at that time", async ({ page, t }) => {
    await openApp(page);
    const thursday = page.locator('main [class*="column"]').nth(3);
    const box = (await thursday.boundingBox())!;
    // 20:10 in the day column → the form starts at 20:00
    await thursday.click({ position: { x: box.width / 2, y: (box.height * (20 * 60 + 10)) / 1440 } });
    const form = page.getByRole("dialog", { name: t.common.newEvent });
    await expect(form.getByLabel(t.editor.startDate)).toHaveValue("2026-11-12");
    await expect(form.getByLabel(t.editor.startTime)).toHaveValue("20:00");
  });

  test("an end before the start is refused", async ({ page, t }) => {
    await openApp(page);
    await page.locator("aside").getByRole("button", { name: t.sidebar.create }).click();
    const form = dialog(page);
    await form.getByPlaceholder(t.editor.titlePlaceholder).fill("Backwards");
    await form.getByLabel(t.editor.startTime).fill("15:00");
    await form.getByLabel(t.editor.endTime).fill("14:00");
    await form.getByRole("button", { name: t.common.save }).click();
    await expect(form).toContainText(t.errors.endBeforeStart);
  });
});

test.describe("drag and resize", () => {
  const pxPerMinute = async (page: Page) => {
    const box = (await page.locator('main [class*="column"]').first().boundingBox())!;
    return box.height / 1440;
  };

  test("dragging an event moves it an hour later and a day on", async ({ page }) => {
    await openApp(page);
    const block = eventBlock(page, "Dentist");
    const box = (await block.boundingBox())!;
    const column = (await page.locator('main [class*="column"]').first().boundingBox())!;
    const ppm = await pxPerMinute(page);
    const x = box.x + box.width / 2;
    const y = box.y + 5;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + column.width / 2, y + 30 * ppm, { steps: 5 });
    await page.mouse.move(x + column.width, y + 60 * ppm, { steps: 5 });
    await page.mouse.up();
    await startsAt(page, "Dentist", 12, [17, 0], [17, 45]);
  });

  test("dragging the bottom edge makes the event longer", async ({ page }) => {
    await openApp(page);
    const block = eventBlock(page, "Dentist");
    const handle = block.locator('[class*="resize"]');
    const box = (await handle.boundingBox())!;
    const ppm = await pxPerMinute(page);
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 30 * ppm, { steps: 6 });
    await page.mouse.up();
    await startsAt(page, "Dentist", 11, [16, 0], [17, 15]);
  });

  test("Esc while dragging puts the event back", async ({ page }) => {
    await openApp(page);
    const block = eventBlock(page, "Dentist");
    const box = (await block.boundingBox())!;
    const ppm = await pxPerMinute(page);
    await page.mouse.move(box.x + box.width / 2, box.y + 5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 5 + 90 * ppm, { steps: 5 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await startsAt(page, "Dentist", 11, [16, 0], [16, 45]);
  });
});
