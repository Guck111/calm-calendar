// Website screenshots of the UI with English mock data (the Store listing reuses some of them).
// Start the dev server first (npm run dev), then: node scripts/screenshots.mjs site
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { capture, launch } from "./lib/chrome.mjs";

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const browser = await launch(9333);

const shoot = async (name, options) => {
  const { data } = await capture(browser, options);
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, "base64"));
  console.log("saved", name);
};

const typeQuickAdd = async (text) => {
  await browser.evaluate(`document.querySelector('input[aria-label="Quick add an event"]').focus()`);
  await browser.cdp("Input.insertText", { text });
};

const WINDOW = { path: "/", width: 1440, height: 900 };
const WIDGET = { path: "/?window=widget", width: 340, height: 760, clip: "[class*='card']", transparent: true };

try {
  await shoot("screenshot-week", { ...WINDOW, scheme: "light", view: "week" });
  await shoot("screenshot-week-dark", { ...WINDOW, scheme: "dark", view: "week" });
  await shoot("screenshot-month", { ...WINDOW, scheme: "light", view: "month" });
  await shoot("screenshot-quick-add", {
    ...WINDOW, scheme: "light", view: "week",
    before: () => typeQuickAdd("Fri 7pm Movie night with Anna 2h #family"),
  });
  await shoot("screenshot-widget", { ...WIDGET, scheme: "light" });
  await shoot("screenshot-widget-dark", { ...WIDGET, scheme: "dark" });
} finally {
  browser.close();
}
