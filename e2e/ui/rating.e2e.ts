// "Enjoying Calm Calendar?": a card asking for a rating in Microsoft Store. Store build only (played here by
// the mockStore switch), two weeks after the first day of use, once: Rate or Not now, and it never returns.
// "Now" in the tests is 11 November 2026.
import type { Page } from "@playwright/test";
import { test, expect, openApp } from "./fixtures";
import type { en } from "../../src/shared/i18n/en";

const card = (page: Page, t: typeof en) => page.getByRole("complementary", { name: t.rating.title });

const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("calm.rating") ?? "null"));

test.describe("Store build, in use for two weeks", () => {
  test.use({ storage: { mockStore: true, rating: { since: "2026-10-28", answered: false } } });

  test("the card shows without taking the focus; Not now closes it for good", async ({ page, t }) => {
    await openApp(page);
    await expect(card(page, t)).toBeVisible();
    await expect(card(page, t)).toContainText(t.rating.text);
    // the calendar keeps working: N still goes to quick add
    await page.keyboard.press("n");
    await expect(page.getByRole("textbox", { name: t.quick.label })).toBeFocused();

    await card(page, t).getByRole("button", { name: t.rating.later }).click();
    await expect(card(page, t)).toBeHidden();
    await page.reload();
    await expect(page.locator("main header")).toBeVisible();
    await expect(page.locator("main [data-event-key]").first()).toBeVisible();
    await expect(card(page, t)).toBeHidden();
  });

  test("Rate closes the card and it does not come back", async ({ page, t }) => {
    await openApp(page);
    await card(page, t).getByRole("button", { name: t.rating.rate }).click();
    await expect(card(page, t)).toBeHidden();
    expect(await stored(page)).toEqual({ since: "2026-10-28", answered: true });
    await page.reload();
    await expect(page.locator("main [data-event-key]").first()).toBeVisible();
    await expect(card(page, t)).toBeHidden();
  });

  test.describe("in Russian", () => {
    test.use({ lang: "ru" });

    test("the card speaks the app language", async ({ page, t }) => {
      await openApp(page);
      await expect(card(page, t).getByRole("button", { name: t.rating.rate })).toBeVisible();
      await expect(card(page, t).getByRole("button", { name: t.rating.later })).toBeVisible();
    });
  });
});

test.describe("Store build, the first days", () => {
  test.use({ storage: { mockStore: true, rating: { since: "2026-10-29", answered: false } } });

  test("no card before two weeks have passed", async ({ page, t }) => {
    await openApp(page);
    await expect(page.locator("main [data-event-key]").first()).toBeVisible();
    await expect(card(page, t)).toBeHidden();
  });
});

test.describe("Store build, the very first start", () => {
  test.use({ storage: { mockStore: true } });

  test("the first day of use is remembered", async ({ page, t }) => {
    await openApp(page);
    await expect(card(page, t)).toBeHidden();
    expect(await stored(page)).toEqual({ since: "2026-11-11", answered: false });
  });
});

test.describe("installer from GitHub", () => {
  test.use({ storage: { rating: { since: "2026-10-01", answered: false } } });

  test("no card outside the Store build", async ({ page, t }) => {
    await openApp(page);
    await expect(page.locator("main [data-event-key]").first()).toBeVisible();
    await expect(card(page, t)).toBeHidden();
  });
});
