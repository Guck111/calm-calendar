// The real app: Settings open in a window of their own (it can be dragged outside the calendar),
// and what is changed there reaches the main window.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readLog, resetAppData, startApp, switchToWindow, useEnglish, waitForText } from "./driver.mjs";

let app;

before(async () => {
  resetAppData();
  app = await startApp();
});

after(async () => {
  await app?.stop();
});

test("the gear opens Settings in a separate window", async () => {
  const { browser } = app;
  await switchToWindow(browser, "main");
  await useEnglish(browser);
  await waitForText(browser, "main button", "Team standup");
  // Month view: week numbers show up there in the cells
  await browser.execute(() =>
    [...document.querySelectorAll("[role=tab]")].find((el) => el.textContent?.startsWith("Month"))?.click(),
  );
  await browser.$('button[aria-label="Settings"]').click();
  assert.equal(await browser.$("[role=dialog]").isExisting(), false, "no dialog inside the main window");

  await switchToWindow(browser, "settings");
  await browser.$('[role=dialog][aria-label="Settings"]').waitForExist({ timeout: 15_000 });
});

test("week numbers turned on in Settings appear in the main window", async () => {
  const { browser } = app;
  await switchToWindow(browser, "settings");
  await browser.execute(() => {
    const label = [...document.querySelectorAll("label")].find((l) => l.textContent?.includes("Week numbers"));
    label?.querySelector("input")?.click();
  });
  await switchToWindow(browser, "main");
  await browser.waitUntil(() => browser.execute(() => document.querySelectorAll('main [title^="Week "]').length > 0), {
    timeout: 5_000,
    timeoutMsg: "no week numbers in the month view",
  });
});

test("Esc closes the Settings window", async () => {
  const { browser } = app;
  await switchToWindow(browser, "settings");
  await browser.keys("Escape");
  await browser.waitUntil(
    async () => {
      for (const handle of await browser.getWindowHandles()) {
        await browser.switchToWindow(handle);
        if (new URL(await browser.getUrl()).searchParams.get("window") === "settings") return false;
      }
      return true;
    },
    { timeout: 5_000, timeoutMsg: "the settings window is still open" },
  );
  assert.doesNotMatch(readLog(), /settings window:/);
});
