// Subscriptions to .ics calendars by link (Settings), and the event location that opens Google Maps.
// The mock feed (src/shared/api/mock.ts): "Morning yoga" on Mondays and Wednesdays at 7:00 at "Studio 5, Main Street 12",
// "Football: City vs United" on Saturday; a link with "broken" is a web page, not a calendar.
import type { Page } from "@playwright/test";
import { test, expect, openApp, eventBlock, dialog } from "./fixtures";
import type { en } from "../../src/shared/i18n/en";

const openSettings = async (page: Page, t: typeof en) => {
  await page.getByRole("button", { name: t.common.settings }).click();
  return page.getByRole("dialog", { name: t.common.settings });
};

/** remember the links the page opens in the browser instead of opening them */
const catchOpened = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { opened: string[] };
    w.opened = [];
    window.open = (url?: string | URL) => {
      w.opened.push(String(url));
      return null;
    };
  });
const opened = (page: Page) => page.evaluate(() => (window as unknown as { opened: string[] }).opened);

test("a subscription by link: a separate group, its events, read only; removing it removes them", async ({ page, t }) => {
  await openApp(page);
  const settings = await openSettings(page, t);
  const link = settings.getByRole("textbox", { name: t.settings.feedUrl });

  // a web page instead of a calendar
  await link.fill("https://example.com/broken.ics");
  await settings.getByRole("button", { name: t.settings.feedAdd }).click();
  await expect(settings).toContainText(t.settings.feedNotIcs);

  // webcal:// is accepted; the name comes from the calendar itself
  await link.fill("webcal://example.com/studio.ics");
  await link.press("Enter");
  await expect(settings.getByRole("listitem")).toContainText("Studio schedule");
  await expect(link).toHaveValue("");

  // the same link once more, written as https with a slash
  await link.fill("https://example.com/studio.ics/");
  await link.press("Enter");
  await expect(settings).toContainText(t.settings.feedExists);
  await settings.getByRole("button", { name: t.common.close }).click();

  const group = page.locator("aside").getByRole("group", { name: t.sidebar.feeds });
  await expect(group).toContainText("Studio schedule");
  await expect(eventBlock(page, "Morning yoga")).toBeVisible();
  await expect(eventBlock(page, "Football: City vs United")).toBeVisible();

  await eventBlock(page, "Morning yoga").click();
  await expect(dialog(page)).toContainText(t.editor.readOnly);
  await expect(dialog(page).getByRole("button", { name: t.editor.edit })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // hidden from the sidebar like any calendar
  await group.getByText("Studio schedule").click();
  await expect(group.getByRole("checkbox")).not.toBeChecked();
  await expect(eventBlock(page, "Morning yoga")).toHaveCount(0);
  await group.getByText("Studio schedule").click();
  await expect(eventBlock(page, "Morning yoga")).toBeVisible();

  // the subscription is remembered
  await page.reload();
  await expect(eventBlock(page, "Morning yoga")).toBeVisible();

  const again = await openSettings(page, t);
  await again.getByRole("button", { name: t.settings.feedRemove("Studio schedule") }).click();
  await again.getByRole("button", { name: t.common.close }).click();
  await expect(group).toHaveCount(0);
  await expect(eventBlock(page, "Morning yoga")).toHaveCount(0);
});

test.describe("with a subscription already added", () => {
  test.use({ storage: { feeds: [{ id: "f1", url: "https://example.com/studio.ics", name: "Studio", color: "#8e63ce" }] } });

  test("search finds events of the subscription", async ({ page, t }) => {
    await openApp(page);
    await page.keyboard.press("Control+f");
    await page.getByRole("textbox", { name: t.search.label }).fill("football");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("listbox").getByRole("option").filter({ hasText: "Football: City vs United" })).toBeVisible();
  });

  test("without a network the subscription shows the last downloaded copy", async ({ page, t }) => {
    await openApp(page);
    await expect(eventBlock(page, "Morning yoga")).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as { calmMock: { outage: string | null } }).calmMock.outage = "network";
    });
    await page.getByRole("button", { name: t.toolbar.refresh }).click();
    await expect(page.getByRole("status")).toContainText(t.errors.offline("09:50"));
    await expect(eventBlock(page, "Morning yoga")).toBeVisible();
  });

  test("the location opens Google Maps", async ({ page, t }) => {
    await openApp(page);
    await catchOpened(page);
    await eventBlock(page, "Morning yoga").click();
    await dialog(page).getByRole("button", { name: /Studio 5, Main Street 12/ }).click();
    const [url] = await opened(page);
    expect(new URL(url).hostname).toBe("www.google.com");
    expect(new URL(url).searchParams.get("query")).toBe("Studio 5, Main Street 12");
    await expect(dialog(page).getByRole("button", { name: /Studio 5/ })).toHaveAttribute("title", t.editor.openMap);
  });
});
