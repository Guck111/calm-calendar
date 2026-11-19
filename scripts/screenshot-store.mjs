// Microsoft Store screenshots that the website does not use, 2880x1800.
// Start the dev server first (npm run dev), then: node scripts/screenshot-store.mjs docs/store
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { capture, launch, sleep } from "./lib/chrome.mjs";

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const browser = await launch(9334);

const WINDOW = { path: "/", width: 1440, height: 900 };

const save = (name, data) => {
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, "base64"));
  console.log("saved", name);
};

const openEvent = (title) =>
  browser.evaluate(`[...document.querySelectorAll("button")].find((b) => b.textContent.startsWith(${JSON.stringify(title)})).click()`);

/** small windows (widget, alert, tray agenda) laid out over a backdrop on a 1440x900 page at 2× */
const compose = async (name, html) => {
  await browser.cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
  await browser.cdp("Emulation.setDefaultBackgroundColorOverride", {});
  await browser.cdp("Page.navigate", { url: "about:blank" });
  await sleep(300);
  await browser.evaluate(`document.open(); document.write(${JSON.stringify(html)}); document.close(); new Promise((r) => setTimeout(r, 500))`);
  save(name, (await browser.cdp("Page.captureScreenshot", { format: "png" })).data);
};

const img = (shot, zoom, style = "") =>
  `<img src="data:image/png;base64,${shot.data}" style="width:${shot.width * zoom}px;height:${shot.height * zoom}px;display:block;${style}">`;

try {
  save("screenshot-event", (await capture(browser, { ...WINDOW, scheme: "light", before: () => openEvent("Design sync") })).data);
  save("screenshot-schedule", (await capture(browser, { ...WINDOW, scheme: "light", view: "agenda" })).data);
  save("screenshot-obsidian-dark", (await capture(browser, { ...WINDOW, scheme: "dark", style: "obsidian" })).data);
  save("screenshot-paper", (await capture(browser, { ...WINDOW, scheme: "light", style: "paper", view: "month" })).data);

  // the widget is 300 CSS px wide; scale 2.5 makes it 375 px on the 2× page
  const widget = { path: "/?window=widget", width: 340, height: 760, clip: "[class*='card']", transparent: true, scale: 2.5 };
  const light = await capture(browser, { ...widget, scheme: "light" });
  const dark = await capture(browser, { ...widget, scheme: "dark" });
  await compose("screenshot-widget-store", `<body style="margin:0;width:1440px;height:900px;background:#E4ECF7;display:flex;align-items:center;justify-content:center;gap:56px">
    ${img(light, 1.25)}${img(dark, 1.25)}</body>`);

  const backdrop = await capture(browser, { ...WINDOW, scheme: "light" });
  // the alert and the agenda at their real size: where Windows puts them, over the calendar
  const alert = await capture(browser, { path: "/?window=alert", width: 460, height: 260, clip: "[class*='card']", transparent: true, scheme: "light" });
  const agenda = await capture(browser, { path: "/?window=agenda", width: 340, height: 440, scheme: "light" });
  const shadow = "box-shadow:0 24px 64px rgba(15,30,60,.28);border-radius:12px;overflow:hidden";
  await compose("screenshot-reminders", `<body style="margin:0;width:1440px;height:900px;position:relative;overflow:hidden">
    <div style="position:absolute;inset:0;filter:blur(3px) brightness(.82)">${img(backdrop, 1)}</div>
    <div style="position:absolute;left:50%;top:120px;transform:translateX(-50%)">${img(alert, 1, shadow)}</div>
    <div style="position:absolute;right:12px;bottom:12px">${img(agenda, 1, shadow)}</div></body>`);
} finally {
  browser.close();
}
