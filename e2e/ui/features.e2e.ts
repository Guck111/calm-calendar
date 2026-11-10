// Time zones, guests, travel time, free time.
import { test, expect, openApp, eventBlock, dialog, blockOn } from "./fixtures";
import type { Page } from "@playwright/test";
import type { en } from "../../src/shared/i18n/en";

const newEvent = async (page: Page, t: typeof en, title: string, day: string, from: string, to: string) => {
  await page.locator("aside").getByRole("button", { name: t.sidebar.create }).click();
  const form = dialog(page);
  await form.getByPlaceholder(t.editor.titlePlaceholder).fill(title);
  await form.getByLabel(t.editor.startDate).fill(day);
  await form.getByLabel(t.editor.startTime).fill(from);
  await form.getByLabel(t.editor.endDate).fill(day);
  await form.getByLabel(t.editor.endTime).fill(to);
  return form;
};

test.describe("time zones", () => {
  test("an event in New York time: the form shows your time, the grid the local time", async ({ page, t }) => {
    await openApp(page);
    const form = await newEvent(page, t, "Call with Boston", "2026-11-12", "10:00", "11:00");
    await form.getByLabel(t.editor.timeZone).selectOption("America/New_York");
    // New York is 6 hours behind Warsaw in November
    await expect(form).toContainText(t.editor.yourTime("").trim());
    await expect(form).toContainText("16:00–17:00");
    await form.getByRole("button", { name: t.common.save }).click();
    await expect(form).toBeHidden();
    const block = await blockOn(page, "Call with Boston", 12);
    await expect(block).toHaveAttribute("title", /^16:00–17:00 /);
    await block.click();
    // the card shows the time in the event's zone too
    await expect(dialog(page)).toContainText("10:00–11:00");
    await expect(dialog(page)).toContainText("New York");
  });

  test("dragging keeps the event's zone", async ({ page, t }) => {
    await openApp(page);
    const form = await newEvent(page, t, "Tokyo sync", "2026-11-12", "18:00", "19:00");
    await form.getByLabel(t.editor.timeZone).selectOption("Asia/Tokyo");
    await form.getByRole("button", { name: t.common.save }).click();
    // 18:00 in Tokyo is 10:00 in Warsaw
    const block = await blockOn(page, "Tokyo sync", 12);
    await expect(block).toHaveAttribute("title", /^10:00–11:00 /);
    const box = (await block.boundingBox())!;
    const column = (await page.locator('main [class*="column"]').first().boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 5 + (column.height / 1440) * 120, { steps: 6 });
    await page.mouse.up();
    await expect(await blockOn(page, "Tokyo sync", 12)).toHaveAttribute("title", /^12:00–13:00 /);
    await (await blockOn(page, "Tokyo sync", 12)).click();
    await expect(dialog(page)).toContainText("20:00–21:00");
    await expect(dialog(page)).toContainText("Tokyo");
  });

  test("second time zone: an extra hour column in Week and Day", async ({ page, t }) => {
    await openApp(page);
    const secondHours = page.locator('main [class*="secondHours"]');
    await expect(secondHours).toHaveCount(0);
    await page.getByRole("button", { name: t.common.settings }).click();
    const settings = page.getByRole("dialog", { name: t.common.settings });
    await settings.getByRole("switch", { name: t.settings.secondZone }).check();
    const zones = settings.getByLabel(t.settings.secondZone, { exact: true });
    // Intl may call it Asia/Calcutta
    const india = await zones.locator("option").evaluateAll((list) =>
      (list as HTMLOptionElement[]).map((o) => o.value).find((v) => /Kolkata|Calcutta/.test(v)),
    );
    await zones.selectOption(india!);
    await settings.getByRole("button", { name: t.common.close }).click();
    await expect(secondHours).toBeVisible();
    // India is 4:30 ahead of Warsaw: the line of 9:00 is 13:30 there
    await expect(secondHours).toHaveAttribute("aria-label", /India|Kolkata/);
    await expect(secondHours.locator("span").nth(9)).toHaveText("13:30");
    await page.keyboard.press("d");
    await expect(secondHours).toBeVisible();
    await page.keyboard.press("m");
    await expect(secondHours).toHaveCount(0);
  });
});

test.describe("guests", () => {
  test("add, refuse a wrong address, remove; the card lists the guests", async ({ page, t }) => {
    await openApp(page);
    const form = await newEvent(page, t, "Planning", "2026-11-12", "11:00", "12:00");
    const field = form.getByLabel(t.editor.addGuest);
    await field.fill("anna@example.com");
    await field.press("Enter");
    await field.fill("not-an-email");
    await field.press("Enter");
    await expect(form).toContainText(t.editor.badEmail);
    await field.fill("oleg@example.com,");
    await field.press(",");
    await field.fill("sam@example.com");
    await field.press("Enter");
    await expect(form).toContainText(t.editor.invitesNote);
    await form.getByRole("button", { name: t.editor.removeGuest("oleg@example.com") }).click();
    await form.getByRole("button", { name: t.common.save }).click();
    await expect(form).toBeHidden();
    await (await blockOn(page, "Planning", 12)).click();
    const card = dialog(page);
    await expect(card).toContainText(t.editor.guests);
    await expect(card).toContainText("anna@example.com");
    await expect(card).toContainText("sam@example.com");
    await expect(card).not.toContainText("oleg@example.com");
  });
});

test.describe("guests of someone else's meeting", () => {
  test.use({ lang: "ru" });

  test("answers are shown, the declined guest is crossed out", async ({ page, t }) => {
    await openApp(page);
    await eventBlock(page, "Созвон с командой").click();
    const card = dialog(page);
    await expect(card).toContainText("Анна");
    await expect(card).toContainText(t.editor.guestStatus.accepted);
    await expect(card).toContainText(t.editor.guestStatus.needsAction);
    await expect(card).toContainText(t.editor.organizer);
    const declined = card.locator("li").filter({ hasText: "oleg@example.com" }).locator('[class*="guestName"]');
    await expect(declined).toHaveCSS("text-decoration-line", "line-through");
  });
});

test.describe("travel time", () => {
  test("a hatched strip before the event and a line in the card", async ({ page, t }) => {
    await openApp(page);
    const form = await newEvent(page, t, "Concert", "2026-11-12", "20:00", "22:00");
    await form.getByLabel(t.editor.travel).selectOption("30");
    await form.getByRole("button", { name: t.common.save }).click();
    await expect(form).toBeHidden();
    const strip = page.locator(`main [title="${t.editor.travelLine("30 min")}"]`);
    await expect(strip).toBeVisible();
    await expect(strip).toContainText(t.editor.onTheWay);
    const block = await blockOn(page, "Concert", 12);
    const a = (await strip.boundingBox())!;
    const b = (await block.boundingBox())!;
    expect(Math.abs(a.y + a.height - b.y)).toBeLessThan(2);
    await block.click();
    await expect(dialog(page)).toContainText(t.editor.travel);
    await expect(dialog(page)).toContainText("30 min");
  });
});

test.describe("free time", () => {
  test.use({ contextOptions: { permissions: ["clipboard-read", "clipboard-write"] } });

  test("the gaps of the week from now on, weekends on and off, Copy", async ({ page, t }) => {
    await openApp(page);
    await page.getByRole("button", { name: t.toolbar.freeSlots }).click();
    const free = page.getByRole("dialog", { name: t.free.title });
    const text = free.getByRole("textbox", { name: t.free.title });
    await expect(text).toHaveValue(/^When I'm free \(/);
    const weekdays = await text.inputValue();
    // today from 9:50: the design sync 11–12, the hiring panel and the dentist 15:30–16:45
    expect(weekdays).toMatch(/Wed[^\n]*: 10:00–11:00, 12:00–15:30 and 16:45–18:00/);
    expect(weekdays).not.toMatch(/Mon|Tue|Sat|Sun/);
    await free.getByLabel(t.free.weekends).check();
    await expect(text).toHaveValue(/Sun/);
    await free.getByRole("button", { name: t.free.copy }).click();
    await expect(free.getByRole("button", { name: t.free.copied })).toBeVisible();
    // Windows gives the text back with CR LF line ends
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied.replace(/\r\n/g, "\n")).toBe(await text.inputValue());
  });
});
