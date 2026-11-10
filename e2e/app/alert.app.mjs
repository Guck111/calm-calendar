// The real app: the hard-to-miss alert window, opened by the debug hook CALM_DEMO_ALERT=1.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { resetAppData, startApp, switchToWindow, useEnglish, waitForText } from "./driver.mjs";

let app;

before(async () => {
  resetAppData();
  app = await startApp({ CALM_DEMO_ALERT: "1" });
});

after(async () => {
  await app?.stop();
});

test("the alert shows the meeting with Join, Snooze and Dismiss", async () => {
  const { browser } = app;
  await switchToWindow(browser, "alert");
  await useEnglish(browser);
  await waitForText(browser, "h1", "Design sync");
  assert.match(await browser.$("section").getText(), /Google Meet/);
  for (const label of ["Join", "Snooze 5 min", "Dismiss"]) {
    assert.equal(await browser.$(`button*=${label}`).isExisting(), true, `no "${label}"`);
  }
});

test("Dismiss closes the alert", async () => {
  const { browser } = app;
  await switchToWindow(browser, "alert");
  const handles = (await browser.getWindowHandles()).length;
  await browser.$("button*=Dismiss").click();
  // the window is hidden or closed: no alert is left in it
  await browser.waitUntil(
    async () => {
      const now = await browser.getWindowHandles();
      if (now.length < handles) return true;
      return (await browser.$$("section h1")).length === 0;
    },
    { timeout: 10_000, timeoutMsg: "the alert stayed" },
  );
});
