// The real app: the quick add window over all windows, opened by the debug hook CALM_DEMO_QUICK=1
// (the same code as the global shortcut Ctrl+Alt+Space). The shortcut itself is registered at start:
// a shortcut taken by another app is only a warning in the log.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR, readLog, resetAppData, startApp, switchToWindow, useEnglish } from "./driver.mjs";

let app;

before(async () => {
  resetAppData();
  app = await startApp({ CALM_DEMO_QUICK: "1" });
});

after(async () => {
  await app?.stop();
});

test("the quick add window has the line, ready to type", async () => {
  const { browser } = app;
  await switchToWindow(browser, "quick");
  await useEnglish(browser);
  const input = await browser.$('input[aria-label="Quick add an event"]');
  await input.waitForExist({ timeout: 15_000, timeoutMsg: "no quick add line" });
  await input.setValue("tomorrow 7pm Gym");
  await browser.waitUntil(async () => (await browser.$("button*=Gym").isExisting()), {
    timeout: 5_000,
    timeoutMsg: "no preview",
  });
});

test("the window was built without errors; a shortcut from the list is registered", async () => {
  const log = readLog();
  assert.doesNotMatch(log, /quick add window:/);
  assert.doesNotMatch(log, /every shortcut is taken/);
  // Ctrl+Alt+Space may be taken by another app: then the next free one is saved in the settings
  const settings = JSON.parse(readFileSync(join(CONFIG_DIR, "settings.json"), "utf8"));
  assert.ok(["ctrl+alt+space", "ctrl+shift+space", "alt+shift+space"].includes(settings.quick_hotkey));
});
