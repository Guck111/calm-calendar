// Settings: the list of sections at the start edge, the options of one section at a time next to it.
import { test, expect, openApp, openSettings } from "./fixtures";

test("sections are listed on the left; the first one, Look, is open", async ({ page, t }) => {
  await openApp(page);
  const settings = await openSettings(page, t);
  const tabs = settings.getByRole("tablist", { name: t.common.settings }).getByRole("tab");
  await expect(tabs).toHaveText([
    t.settings.groupLook,
    t.settings.groupCalendar,
    t.settings.groupReminders,
    t.settings.groupQuick,
    t.settings.groupHelp,
  ]);
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  const look = settings.getByRole("tabpanel", { name: t.settings.groupLook });
  await expect(look.getByRole("radio", { name: t.settings.themes.dark })).toBeVisible();
  await expect(settings.getByRole("tabpanel")).toHaveCount(1);
  await expect(settings.getByLabel(t.settings.language)).toBeHidden();

  const list = (await settings.getByRole("tablist").boundingBox())!;
  const panel = (await look.boundingBox())!;
  expect(list.x + list.width).toBeLessThanOrEqual(panel.x);
});

test("a click on a section shows its options instead of the previous ones", async ({ page, t }) => {
  await openApp(page);
  const settings = await openSettings(page, t);
  await settings.getByRole("tab", { name: t.settings.groupCalendar }).click();
  await expect(settings.getByRole("tab", { name: t.settings.groupCalendar })).toHaveAttribute("aria-selected", "true");
  const calendar = settings.getByRole("tabpanel", { name: t.settings.groupCalendar });
  await expect(calendar.getByLabel(t.settings.language)).toBeVisible();
  await expect(calendar.getByRole("switch", { name: t.settings.weekNumbers })).toBeVisible();
  await expect(settings.getByRole("radio", { name: t.settings.themes.dark })).toBeHidden();

  await settings.getByRole("tab", { name: t.settings.groupReminders }).click();
  await expect(settings.getByRole("tabpanel", { name: t.settings.groupReminders }).getByLabel(t.alert.label)).toBeVisible();
  await expect(calendar).toBeHidden();
});

test("Quick access: the shortcut, the widget and launch with Windows, with the note about the tray", async ({ page, t }) => {
  await openApp(page);
  const settings = await openSettings(page, t, "groupQuick");
  const quick = settings.getByRole("tabpanel", { name: t.settings.groupQuick });
  await expect(quick.getByLabel(t.settings.quickHotkey)).toBeVisible();
  // they need the app: in the browser they are there but off
  for (const name of [t.welcome.widget, t.settings.onTop, t.welcome.autostart]) {
    await expect(quick.getByRole("switch", { name })).toBeDisabled();
  }
  await expect(quick).toContainText(t.settings.trayHint);
});

test("the app version stands under the list of sections, whatever section is open", async ({ page, t }) => {
  await openApp(page);
  const settings = await openSettings(page, t);
  const version = await page.evaluate(async () => {
    const path = "/src/shared/lib/version.ts";
    return (await import(/* @vite-ignore */ path)).APP_VERSION as string;
  });
  expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  const line = settings.getByText(t.settings.version(version), { exact: true });
  await expect(line).toBeVisible();
  const list = (await settings.getByRole("tablist").boundingBox())!;
  expect((await line.boundingBox())!.y).toBeGreaterThanOrEqual(list.y + list.height);
  await settings.getByRole("tab", { name: t.settings.groupCalendar }).click();
  await expect(line).toBeVisible();
});

test("What's new under the version opens this version's notes on the website", async ({ page, t }) => {
  await openApp(page);
  await page.evaluate(() => {
    const w = window as unknown as { opened: string[] };
    w.opened = [];
    window.open = (url?: string | URL) => {
      w.opened.push(String(url));
      return null;
    };
  });
  const settings = await openSettings(page, t);
  const version = await page.evaluate(async () => {
    const path = "/src/shared/lib/version.ts";
    return (await import(/* @vite-ignore */ path)).APP_VERSION as string;
  });
  await settings.getByRole("button", { name: t.settings.whatsNew }).click();
  const opened = () => page.evaluate(() => (window as unknown as { opened: string[] }).opened);
  await expect.poll(opened).toEqual([`https://calmcalendar.co.uk/whats-new.html#v${version}`]);
  // Settings stay open
  await expect(settings).toBeVisible();
});

test("arrow keys move between sections", async ({ page, t }) => {
  await openApp(page);
  const settings = await openSettings(page, t);
  const tab = (name: string) => settings.getByRole("tab", { name });
  await tab(t.settings.groupLook).focus();
  await page.keyboard.press("ArrowDown");
  await expect(tab(t.settings.groupCalendar)).toBeFocused();
  await expect(tab(t.settings.groupCalendar)).toHaveAttribute("aria-selected", "true");
  await expect(settings.getByLabel(t.settings.language)).toBeVisible();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  // from the first section up is the last one
  await expect(tab(t.settings.groupHelp)).toHaveAttribute("aria-selected", "true");
  // the calendar behind the dialog does not page on these keys
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
});

test("a choice made in one section is kept while another is open", async ({ page, t }) => {
  await openApp(page);
  const settings = await openSettings(page, t, "groupCalendar");
  await settings.getByRole("textbox", { name: t.settings.feedUrl }).fill("https://example.com/half-typed");
  await settings.getByRole("tab", { name: t.settings.groupLook }).click();
  await settings.getByRole("tab", { name: t.settings.groupCalendar }).click();
  await expect(settings.getByRole("textbox", { name: t.settings.feedUrl })).toHaveValue("https://example.com/half-typed");
});

test("a low window: the open section scrolls, the list of sections stays in place", async ({ page, t }) => {
  await page.setViewportSize({ width: 900, height: 540 });
  await openApp(page);
  const settings = await openSettings(page, t, "groupCalendar");
  expect(await settings.evaluate((el) => el.getBoundingClientRect().bottom <= window.innerHeight)).toBe(true);
  const panel = settings.getByRole("tabpanel", { name: t.settings.groupCalendar });
  const last = panel.getByRole("textbox", { name: t.settings.feedUrl });
  await expect(last).not.toBeInViewport();
  await panel.hover();
  await page.mouse.wheel(0, 2000);
  await expect(last).toBeInViewport();
  await expect(settings.getByRole("tab", { name: t.settings.groupLook })).toBeInViewport();
  await expect(settings.getByRole("button", { name: t.common.close })).toBeInViewport();
});

test.describe("right to left", () => {
  test.use({ lang: "ar" });

  test("the list of sections stands on the right", async ({ page, t }) => {
    await openApp(page);
    const settings = await openSettings(page, t);
    const list = (await settings.getByRole("tablist").boundingBox())!;
    const panel = (await settings.getByRole("tabpanel").boundingBox())!;
    expect(panel.x + panel.width).toBeLessThanOrEqual(list.x);
  });
});

test("the Settings window of the app has the same sections", async ({ page, t }) => {
  await page.goto("/?window=settings");
  const settings = page.getByRole("dialog", { name: t.common.settings });
  await expect(settings.getByRole("tab")).toHaveCount(5);
  await settings.getByRole("tab", { name: t.settings.groupReminders }).click();
  await expect(settings.getByRole("switch", { name: t.settings.notifications })).toBeVisible();
  // the window is filled edge to edge
  const box = (await settings.boundingBox())!;
  expect(box.width).toBe(page.viewportSize()!.width);
  expect(box.height).toBe(page.viewportSize()!.height);
});
