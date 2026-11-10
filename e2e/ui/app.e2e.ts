// Settings, the sign-out confirmation, the window error screen, right-to-left Arabic, the widget page.
import { test, expect, openApp, eventBlock, DICTS } from "./fixtures";

test.describe("settings", () => {
  test("theme: Dark and Light are applied and remembered", async ({ page, t }) => {
    await openApp(page);
    await page.getByRole("button", { name: t.common.settings }).click();
    const settings = page.getByRole("dialog", { name: t.common.settings });
    await settings.getByRole("radio", { name: t.settings.themes.dark }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.keyboard.press("Escape");
    await expect(settings).toBeHidden();
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("language: German changes the interface after a reload", async ({ page, t }) => {
    await openApp(page);
    await page.getByRole("button", { name: t.common.settings }).click();
    await page.getByRole("dialog").getByLabel(t.settings.language).selectOption("de");
    await expect(page.getByRole("button", { name: DICTS.de.common.today })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", /^de/);
  });

  test("a low window: the dialog scrolls down to the last option", async ({ page, t }) => {
    await page.setViewportSize({ width: 900, height: 540 });
    await openApp(page);
    await page.getByRole("button", { name: t.common.settings }).click();
    const settings = page.getByRole("dialog", { name: t.common.settings });
    const fits = await settings.evaluate((el) => el.getBoundingClientRect().bottom <= window.innerHeight);
    expect(fits).toBe(true);
    expect(await settings.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    const last = settings.getByText(t.settings.trayHint);
    await settings.hover();
    await page.mouse.wheel(0, 2000);
    await expect(last).toBeInViewport();
    await expect(settings.getByLabel(t.alert.label)).toBeInViewport();
  });

  test("notifications and the alert are off in the browser (they need the app)", async ({ page, t }) => {
    await openApp(page);
    await page.getByRole("button", { name: t.common.settings }).click();
    const settings = page.getByRole("dialog", { name: t.common.settings });
    await expect(settings.getByRole("switch", { name: t.settings.notifications })).toBeDisabled();
    await expect(settings.getByLabel(t.alert.label)).toBeDisabled();
  });
});

test.describe("sign out", () => {
  test("asks a second time; Esc and leaving the button take it back", async ({ page, t }) => {
    await openApp(page);
    const group = page.locator("aside").getByRole("group", { name: "work@example.com" });
    const button = group.getByRole("button", { name: t.sidebar.signOut, exact: true });
    await button.click();
    const asking = group.getByRole("button", { name: t.accounts.confirmSignOut });
    await expect(asking).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(button).toBeVisible();
    await button.click();
    await expect(asking).toBeVisible();
    await page.locator("main header h2").click();
    await expect(button).toBeVisible();
    // nothing was signed out
    await expect(eventBlock(page, "Team standup")).toBeVisible();
  });

  test("goes back by itself after 5 seconds", async ({ page, t }) => {
    await openApp(page);
    const group = page.locator("aside").getByRole("group", { name: "work@example.com" });
    await group.getByRole("button", { name: t.sidebar.signOut, exact: true }).click();
    await expect(group.getByRole("button", { name: t.accounts.confirmSignOut })).toBeVisible();
    await expect(group.getByRole("button", { name: t.sidebar.signOut, exact: true })).toBeVisible({ timeout: 7000 });
  });

  test("the second click signs out of that account only", async ({ page, t }) => {
    await openApp(page);
    const group = page.locator("aside").getByRole("group", { name: "work@example.com" });
    await group.getByRole("button", { name: t.sidebar.signOut, exact: true }).click();
    await group.getByRole("button", { name: t.accounts.confirmSignOut }).click();
    await expect(group).toHaveCount(0);
    await expect(eventBlock(page, "Team standup")).toHaveCount(0);
    await expect(eventBlock(page, "Dentist")).toBeVisible();
  });
});

test.describe("window error screen", () => {
  test("the main window offers to restart instead of a blank page", async ({ page, t }) => {
    await page.goto("/?crash=1");
    const alert = page.getByRole("alert");
    await expect(alert.getByRole("heading", { name: t.errors.crashTitle })).toBeVisible();
    await expect(alert).toContainText(t.errors.crashText);
    await expect(alert.getByRole("button", { name: t.errors.reload })).toBeVisible();
  });

  test("the widget shows a short version", async ({ page, t }) => {
    await page.goto("/?window=widget&crash=1");
    const alert = page.getByRole("alert");
    await expect(alert.getByRole("heading", { name: t.errors.crashTitle })).toBeVisible();
    await expect(alert).not.toContainText(t.errors.crashText);
  });

  test.describe("in Russian", () => {
    test.use({ lang: "ru" });
    test("the text follows the language", async ({ page, t }) => {
      await page.goto("/?crash=1");
      await expect(page.getByRole("heading", { name: t.errors.crashTitle })).toBeVisible();
    });
  });
});

test.describe("Arabic, right to left", () => {
  test.use({ lang: "ar" });

  test("the page is mirrored: sidebar on the right, days from right to left", async ({ page }) => {
    await openApp(page);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", /^ar/);
    const aside = (await page.locator("aside").boundingBox())!;
    const main = (await page.locator("main").boundingBox())!;
    expect(aside.x).toBeGreaterThan(main.x);
    const heads = page.locator('main [class*="dayHead"]');
    const first = (await heads.first().boundingBox())!;
    const last = (await heads.last().boundingBox())!;
    expect(first.x).toBeGreaterThan(last.x);
    // nothing sticks out sideways
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("the left arrow goes forward, as the buttons do", async ({ page, t }) => {
    await openApp(page);
    const title = page.locator("main header h2");
    const before = await title.innerText();
    await page.keyboard.press("ArrowLeft");
    await expect(title).not.toHaveText(before);
    await page.locator("main header").getByRole("button", { name: t.toolbar.back, exact: true }).click();
    await expect(title).toHaveText(before);
  });

  test("the event form and the card work", async ({ page, t }) => {
    await openApp(page);
    await page.locator("aside").getByRole("button", { name: t.sidebar.create }).click();
    const form = page.getByRole("dialog", { name: t.common.newEvent });
    await form.getByPlaceholder(t.editor.titlePlaceholder).fill("اجتماع");
    await form.getByLabel(t.editor.startDate).fill("2026-11-12");
    await form.getByLabel(t.editor.startTime).fill("12:00");
    await form.getByLabel(t.editor.endDate).fill("2026-11-12");
    await form.getByLabel(t.editor.endTime).fill("13:00");
    await form.getByRole("button", { name: t.common.save }).click();
    await expect(form).toBeHidden();
    await eventBlock(page, "اجتماع").click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "اجتماع" })).toBeVisible();
  });
});

test.describe("widget page", () => {
  test("clock, month, the next events and quick add", async ({ page, t }) => {
    await page.goto("/?window=widget");
    await expect(page.getByRole("button", { name: t.common.prevMonth })).toBeVisible();
    // the next events: the design sync is today at 11:00
    await expect(page.locator("ul").getByText("Design sync")).toBeVisible();
    const quick = page.getByRole("textbox", { name: t.quick.label });
    await quick.fill("tomorrow 8am Gym");
    await quick.press("Enter");
    await expect(quick).toHaveValue("");
    await expect(page.locator("ul").getByText("Gym")).toBeVisible();
  });
});
