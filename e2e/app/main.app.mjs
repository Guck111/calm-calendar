// The real app: the main window and the desktop widget on mock data, the log without personal data.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readLog, resetAppData, startApp, switchToWindow, useEnglish, waitForText } from "./driver.mjs";

let app;

before(async () => {
  // the widget is shown, as after "Show widget" in the tray menu
  resetAppData({ widget: true });
  app = await startApp();
});

after(async () => {
  await app?.stop();
});

test("the main window is a Tauri window with the week of mock events", async () => {
  const { browser } = app;
  await switchToWindow(browser, "main");
  await useEnglish(browser);
  assert.equal(await browser.getTitle(), "Calm Calendar");
  assert.equal(await browser.execute(() => "__TAURI_INTERNALS__" in window), true);
  // the stand-up repeats every weekday: it is in every week
  await waitForText(browser, "main button", "Team standup");
  const accounts = await browser.$$("aside [role=group]");
  assert.ok(accounts.length >= 2, "two mock accounts in the sidebar");
});

test("quick add creates an event for tomorrow", async () => {
  const { browser } = app;
  await switchToWindow(browser, "main");
  const input = await browser.$('input[aria-label="Quick add an event"]');
  await input.setValue("tomorrow 6am E2E check 30 min");
  await browser.keys("Enter");
  await browser.waitUntil(async () => (await input.getValue()) === "", { timeoutMsg: "quick add did not clear" });
  // Day view of tomorrow: D, then the next day
  await browser.$("main").click();
  await browser.keys("d");
  await browser.keys("ArrowRight");
  await waitForText(browser, "main button", "E2E check");
});

test("the widget window shows the clock, the month and the next events", async () => {
  const { browser } = app;
  await switchToWindow(browser, "widget");
  await useEnglish(browser);
  await browser.$('button[aria-label="Next month"]').waitForExist({ timeout: 15_000 });
  const clock = await browser.$("button[title='Open calendar']").getText();
  assert.match(clock, /\d{1,2}:\d{2}/);
  await browser.waitUntil(async () => (await browser.$$("ul li")).length > 0, {
    timeout: 15_000,
    timeoutMsg: "no upcoming events in the widget",
  });
  assert.equal(await browser.$('input[aria-label="Quick add an event"]').isExisting(), true);
});

test("the log has the app start and no personal data", async () => {
  const log = readLog();
  assert.match(log, /Calm Calendar/i);
  for (const secret of ["me@example.com", "work@example.com", "Team standup", "E2E check"]) {
    assert.ok(!log.includes(secret), `the log has "${secret}"`);
  }
});
