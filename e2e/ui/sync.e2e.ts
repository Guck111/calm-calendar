// The time of the last load from Google and a retry when Google does not answer.
// window.calmMock.outage (mock data only) makes every Google request fail: "network" or "503".
import { test, expect, openApp, eventBlock } from "./fixtures";
import type { Page } from "@playwright/test";

const outage = (page: Page, kind: "network" | "503" | null) =>
  page.evaluate((k) => {
    (window as unknown as { calmMock: { outage: string | null } }).calmMock.outage = k;
  }, kind);

test("the sidebar says when the calendar was updated", async ({ page, t }) => {
  await openApp(page);
  await expect(page.locator("aside")).toContainText(t.sync.updated("09:50"));
});

test("without a network: the saved weeks, a Retry button, and the app tries again by itself", async ({ page, t }) => {
  await openApp(page);
  await outage(page, "network");
  await page.getByRole("button", { name: t.toolbar.refresh }).click();
  const banner = page.getByRole("status");
  await expect(banner).toContainText(t.errors.offline("09:50"));
  // the saved data stays on screen
  await expect(eventBlock(page, "Dentist")).toBeVisible();
  await outage(page, null);
  // the first retry is 5 seconds later
  await expect(banner).toBeHidden({ timeout: 10_000 });
});

test("Google answers 503: an error with Retry; Retry loads again", async ({ page, t }) => {
  // a week that was never loaded has no saved copy, so the error shows
  await openApp(page);
  await outage(page, "503");
  await page.getByRole("button", { name: t.toolbar.forward }).click();
  await page.getByRole("button", { name: t.toolbar.forward }).click();
  const banner = page.getByRole("status");
  await expect(banner).toContainText(t.errors.google(503));
  await outage(page, null);
  await banner.getByRole("button", { name: t.sync.retry }).click();
  await expect(banner).toBeHidden();
  await expect(page.locator("main button[title]").filter({ hasText: "Team standup" }).first()).toBeVisible();
});

test.describe("in Hindi", () => {
  test.use({ lang: "hi" });
  test("the retry button is translated", async ({ page, t }) => {
    await openApp(page);
    await outage(page, "503");
    await page.getByRole("button", { name: t.toolbar.forward }).click();
    await page.getByRole("button", { name: t.toolbar.forward }).click();
    await expect(page.getByRole("status").getByRole("button", { name: t.sync.retry })).toBeVisible();
  });
});
