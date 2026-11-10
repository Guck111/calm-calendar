// The global quick add shortcut: the choice in Settings and the small quick add window it opens
// (?window=quick; the shortcut itself is registered by Rust and checked in the app tests).
import { test, expect, openApp } from "./fixtures";

test("Settings: the shortcut for quick add from anywhere, Ctrl+Alt+Space by default", async ({ page, t }) => {
  await openApp(page);
  await page.getByRole("button", { name: t.common.settings }).click();
  const select = page.getByRole("combobox", { name: t.settings.quickHotkey });
  await expect(select).toHaveValue("ctrl+alt+space");
  await expect(select.locator("option")).toContainText([t.settings.hotkeyOff, "Ctrl+Alt+Space", "Ctrl+Shift+Space"]);
});

test("the quick add window: type, Enter, the field is empty again", async ({ page, t }) => {
  await page.goto("/?window=quick");
  const input = page.getByRole("textbox", { name: t.quick.label });
  await expect(input).toBeFocused();
  await input.fill("tomorrow 7pm Gym");
  await expect(page.getByRole("button", { name: /Gym/ })).toBeVisible();
  await input.press("Enter");
  await expect(input).toHaveValue("");
});
