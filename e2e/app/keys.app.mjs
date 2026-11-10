// The real app (WebView2): shortcuts that a browser could keep for itself reach the page.
// Ctrl+K, Ctrl+D (in Edge: add to favorites) and ? are pressed through WebDriver, as from the keyboard.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { resetAppData, startApp, switchToWindow, useEnglish, waitForText } from "./driver.mjs";

let app;

before(async () => {
  resetAppData();
  app = await startApp();
});

after(async () => {
  await app?.stop();
});

const dialogNamed = (browser, name) => browser.$(`[role="dialog"][aria-label="${name}"]`);

test("Ctrl+K opens the command menu, Esc closes it", async () => {
  const { browser } = app;
  await switchToWindow(browser, "main");
  await useEnglish(browser);
  await waitForText(browser, "main button", "Dentist");
  await browser.$("main").click();
  await browser.keys(["Control", "k"]);
  const menu = await dialogNamed(browser, "Commands");
  await menu.waitForExist({ timeout: 5_000, timeoutMsg: "Ctrl+K did not open the menu" });
  await browser.keys("Escape");
  await menu.waitForExist({ reverse: true, timeout: 5_000 });
});

test("Ctrl+D on an event opens the form of a copy", async () => {
  const { browser } = app;
  await switchToWindow(browser, "main");
  await browser.execute(() =>
    [...document.querySelectorAll("main [data-event-key]")].find((b) => b.textContent?.includes("Dentist"))?.focus(),
  );
  await browser.keys(["Control", "d"]);
  const form = await dialogNamed(browser, "New event");
  await form.waitForExist({ timeout: 5_000, timeoutMsg: "Ctrl+D did not open the copy" });
  assert.equal(await browser.$('input[placeholder="Title"]').getValue(), "Dentist");
  await browser.keys("Escape");
  await form.waitForExist({ reverse: true, timeout: 5_000 });
});

test("? opens the list of shortcuts", async () => {
  const { browser } = app;
  await switchToWindow(browser, "main");
  // no card or form open, nothing focused (a click on main could open an event)
  await browser.execute(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
  assert.equal(await browser.$('[role="dialog"]').isExisting(), false);
  await browser.keys(["Shift", "?"]);
  await (await dialogNamed(browser, "Keyboard shortcuts")).waitForExist({ timeout: 5_000, timeoutMsg: "? did not open the list" });
});
