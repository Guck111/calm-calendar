// "What else Calm Calendar can do": a card after the first sign-in with the widget, launch with Windows,
// the hard-to-miss alert, quick add from anywhere and the tray agenda. Shown once; Ctrl+K brings it back.
import { test, expect, openApp } from "./fixtures";

test.describe("first start", () => {
  test.use({ storage: { welcome: false } });

  test("the card shows once, does not take the focus, and stays closed after Done", async ({ page, t }) => {
    await openApp(page);
    const card = page.getByRole("dialog", { name: t.welcome.title });
    await expect(card).toBeVisible();
    await expect(card).toContainText(t.welcome.widget);
    await expect(card).toContainText(t.welcome.autostart);
    await expect(card).toContainText(t.welcome.alert);
    await expect(card).toContainText(t.welcome.hotkey);
    await expect(card).toContainText("Ctrl+Alt+Space");
    await expect(card).toContainText(t.welcome.tray);
    // the calendar keeps working: N still goes to quick add
    await page.keyboard.press("n");
    await expect(page.getByRole("textbox", { name: t.quick.label })).toBeFocused();

    await card.getByRole("button", { name: t.welcome.done }).click();
    await expect(card).toBeHidden();
    await page.reload();
    await expect(page.getByRole("tablist")).toBeVisible();
    await expect(card).toBeHidden();
  });

  test("the switches need the app: in the browser they are off and disabled", async ({ page, t }) => {
    await openApp(page);
    const card = page.getByRole("dialog", { name: t.welcome.title });
    for (const name of [t.welcome.widget, t.welcome.autostart, t.welcome.alert]) {
      await expect(card.getByRole("switch", { name })).toBeDisabled();
    }
  });
});

test("Ctrl+K brings the card back", async ({ page, t }) => {
  await openApp(page);
  const card = page.getByRole("dialog", { name: t.welcome.title });
  await expect(card).toBeHidden();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: t.commands.title }).getByRole("combobox")).toBeFocused();
  await page.keyboard.type(t.welcome.command.slice(0, 6));
  await page.getByRole("option", { name: t.welcome.command }).click();
  await expect(card).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: t.welcome.done }).focus();
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
});
