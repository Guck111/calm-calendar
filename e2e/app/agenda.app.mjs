// The real app: the tray agenda for today and tomorrow, opened by the debug hook CALM_DEMO_AGENDA=1
// (the same code as a left click on the tray icon).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { resetAppData, startApp, switchToWindow, useEnglish } from "./driver.mjs";

let app;

before(async () => {
  resetAppData();
  app = await startApp({ CALM_DEMO_AGENDA: "1" });
});

after(async () => {
  await app?.stop();
});

test("the agenda lists today and tomorrow with Open calendar", async () => {
  const { browser } = app;
  await switchToWindow(browser, "agenda");
  await useEnglish(browser);
  await browser.waitUntil(async () => (await browser.$$("section h2")).length === 2, {
    timeout: 15_000,
    timeoutMsg: "no Today and Tomorrow",
  });
  const days = await browser.$$("section h2");
  assert.match(await days[0].getText(), /^Today/);
  assert.match(await days[1].getText(), /^Tomorrow/);
  // the mock week has events on every day
  await browser.waitUntil(async () => (await browser.$$("section li")).length > 0, {
    timeout: 15_000,
    timeoutMsg: "the agenda is empty",
  });
  assert.equal(await browser.$("button*=Open calendar").isExisting(), true);
});
