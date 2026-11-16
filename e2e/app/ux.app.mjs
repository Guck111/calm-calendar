// The real app, changes from the UX review that need Rust or WebView2: the first-start card, the widget,
// "on top" and launch-with-Windows switches (they change the same settings as the tray menu), and Ctrl+Z
// after a delete. Launch with Windows is tested only when the computer has no "Calm Calendar" entry in
// the Run key yet, and the entry is removed again, so the installed app is never touched.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR, resetAppData, startApp, switchToWindow, useEnglish, waitForText } from "./driver.mjs";

const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";

/** the Run key value of the app, or null */
const runEntry = () => {
  try {
    return execFileSync("reg", ["query", RUN_KEY, "/v", "Calm Calendar"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
};

const widgetSettings = () => {
  const file = join(CONFIG_DIR, "widget.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
};

/** a switch by the start of its label text, in the window that is active now */
const switchState = (browser, label) =>
  browser.execute((text) => {
    const l = [...document.querySelectorAll("label")].find((x) => x.querySelector("b")?.textContent === text);
    const input = l?.querySelector("input[role=switch]");
    return input ? { checked: input.checked, disabled: input.disabled } : null;
  }, label);

const flip = (browser, label) =>
  browser.execute((text) => {
    const l = [...document.querySelectorAll("label")].find((x) => x.querySelector("b")?.textContent === text);
    l?.querySelector("input[role=switch]")?.click();
  }, label);

let app;
const hadRunEntry = runEntry() !== null;

before(async () => {
  resetAppData();
  app = await startApp();
});

after(async () => {
  await app?.stop();
  // whatever happened, the test app leaves no launch entry behind
  if (!hadRunEntry && runEntry() !== null) execFileSync("reg", ["delete", RUN_KEY, "/v", "Calm Calendar", "/f"]);
});

test("first start: the card shows the real state and turns the widget on", async () => {
  const { browser } = app;
  await switchToWindow(browser, "main");
  await useEnglish(browser);
  await waitForText(browser, "main button", "Team standup");
  await browser.$('aside[aria-labelledby="welcome-title"]').waitForExist({ timeout: 10_000 });

  const widget = await switchState(browser, "Desktop widget");
  assert.ok(widget, "the widget switch is there");
  assert.equal(widget.disabled, false, "in the app the switches work");

  await (widget.checked ? flip(browser, "Desktop widget") : Promise.resolve());
  await browser.waitUntil(async () => widgetSettings()?.visible === false, { timeout: 5_000, timeoutMsg: "widget not off" });
  await flip(browser, "Desktop widget");
  await browser.waitUntil(async () => widgetSettings()?.visible === true, { timeout: 5_000, timeoutMsg: "widget not on" });
  assert.equal((await switchState(browser, "Desktop widget")).checked, true);

  await browser.execute(() =>
    [...document.querySelectorAll("aside[aria-labelledby=welcome-title] button")].find((b) => b.textContent === "Done")?.click(),
  );
  await browser.waitUntil(async () => !(await browser.$('[aria-labelledby="welcome-title"]').isExisting()), {
    timeout: 5_000,
    timeoutMsg: "the card did not close",
  });
});

test("Settings → Quick access: on top and the widget switch change widget.json", async () => {
  const { browser } = app;
  await switchToWindow(browser, "main");
  await browser.$('button[aria-label="Settings"]').click();
  await switchToWindow(browser, "settings");
  await browser.$('[role=dialog][aria-label="Settings"]').waitForExist({ timeout: 15_000 });
  await browser.waitUntil(async () => (await switchState(browser, "Desktop widget"))?.checked === true, {
    timeout: 5_000,
    timeoutMsg: "Settings do not show the widget as on",
  });

  await flip(browser, "Keep the widget on top");
  await browser.waitUntil(async () => widgetSettings()?.on_top === true, { timeout: 5_000, timeoutMsg: "on top not saved" });
  await flip(browser, "Keep the widget on top");
  await browser.waitUntil(async () => widgetSettings()?.on_top === false, { timeout: 5_000, timeoutMsg: "on top not off" });
});

test("Settings → Quick access: launch with Windows writes and removes the Run entry", { skip: hadRunEntry && "the computer already has a Calm Calendar launch entry" }, async () => {
  const { browser } = app;
  await switchToWindow(browser, "settings");
  assert.equal((await switchState(browser, "Start with Windows")).checked, false);
  await flip(browser, "Start with Windows");
  await browser.waitUntil(async () => runEntry() !== null, { timeout: 5_000, timeoutMsg: "no Run entry" });
  assert.match(runEntry(), /calm-calendar\.exe/i);
  assert.equal((await switchState(browser, "Start with Windows")).checked, true);
  await flip(browser, "Start with Windows");
  await browser.waitUntil(async () => runEntry() === null, { timeout: 5_000, timeoutMsg: "the Run entry stayed" });
  await browser.keys("Escape");
});

test("Ctrl+Z in WebView2 brings a deleted event back", async () => {
  const { browser } = app;
  await switchToWindow(browser, "main");
  const count = () =>
    browser.execute(() => [...document.querySelectorAll("main button[title]")].filter((b) => b.textContent?.includes("Dentist")).length);
  assert.ok((await count()) > 0, "Dentist is on screen");
  await browser.execute(() =>
    [...document.querySelectorAll("main button[title]")].find((b) => b.textContent?.includes("Dentist"))?.click(),
  );
  await browser.$("[role=dialog]").waitForExist({ timeout: 5_000 });
  await browser.execute(() =>
    [...document.querySelectorAll("[role=dialog] button")].find((b) => b.textContent === "Delete")?.click(),
  );
  await browser.waitUntil(async () => (await count()) === 0, { timeout: 5_000, timeoutMsg: "Dentist still there" });
  await browser.execute(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
  await browser.keys(["Control", "z"]);
  await browser.waitUntil(async () => (await count()) > 0, { timeout: 5_000, timeoutMsg: "Ctrl+Z did not bring it back" });
});
