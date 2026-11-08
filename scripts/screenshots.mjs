// Screenshots of the UI with English mock data (for the website and the Store listing).
// Start the dev server first (npm run dev), then: node scripts/screenshots.mjs site
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://localhost:1420";
const PORT = 9333;

const profile = mkdtempSync(join(tmpdir(), "calm-shots-"));
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--lang=en-US", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = async () => {
  for (let i = 0; i < 50; i++) {
    try { return await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch { await sleep(200); }
  }
  throw new Error("chrome did not start");
};

const connect = async () => {
  const page = (await targets()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  });
  return (method, params = {}) =>
    new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
};

// Wednesday of the current week, 10:20: morning events visible, a countdown in the widget
const FAKE_CLOCK = `(() => {
  const Real = Date;
  const now = new Real();
  const wed = new Real(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + 3, 9, 50);
  const offset = wed.getTime() - Real.now();
  class FakeDate extends Real {
    constructor(...a) { a.length ? super(...a) : super(Real.now() + offset); }
    static now() { return Real.now() + offset; }
  }
  globalThis.Date = FakeDate;
  try { localStorage.setItem("calm.lang", JSON.stringify("en")); } catch {}
})();`;

const cdp = await connect();
await cdp("Page.enable");
await cdp("Runtime.enable");
await cdp("Page.addScriptToEvaluateOnNewDocument", { source: FAKE_CLOCK });

const evaluate = async (expression) =>
  (await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;

const shoot = async ({ name, path, width, height, scheme, view, clip, transparent, before }) => {
  await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: false });
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
  await cdp("Emulation.setDefaultBackgroundColorOverride", transparent ? { color: { r: 0, g: 0, b: 0, a: 0 } } : {});
  if (view) await evaluate(`localStorage.setItem("calm.view", JSON.stringify("${view}"))`);
  await cdp("Page.navigate", { url: `${BASE}${path}` });
  await sleep(2500);
  if (before) {
    await before();
    await sleep(800);
  }
  let rect;
  if (clip) {
    rect = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(clip)}).getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 }; })()`);
  }
  const { data } = await cdp("Page.captureScreenshot", { format: "png", ...(rect ? { clip: rect } : {}), captureBeyondViewport: false });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, "base64"));
  console.log("saved", name);
};

const typeQuickAdd = async (text) => {
  await evaluate(`document.querySelector('input[aria-label="Quick add an event"]').focus()`);
  await cdp("Input.insertText", { text });
};

try {
  // which localStorage key holds the view: read it once from the page
  await cdp("Page.navigate", { url: BASE });
  await sleep(2000);
  const keys = await evaluate("Object.keys(localStorage)");
  console.log("localStorage keys:", keys.join(", "));

  await shoot({ name: "screenshot-week", path: "/", width: 1440, height: 900, scheme: "light", view: "week" });
  await shoot({ name: "screenshot-week-dark", path: "/", width: 1440, height: 900, scheme: "dark", view: "week" });
  await shoot({ name: "screenshot-month", path: "/", width: 1440, height: 900, scheme: "light", view: "month" });
  await shoot({
    name: "screenshot-quick-add", path: "/", width: 1440, height: 900, scheme: "light", view: "week",
    before: () => typeQuickAdd("Fri 7pm Movie night with Anna 2h #family"),
  });
  await shoot({ name: "screenshot-widget", path: "/?window=widget", width: 340, height: 760, scheme: "light", clip: "[class*='card']", transparent: true });
  await shoot({ name: "screenshot-widget-dark", path: "/?window=widget", width: 340, height: 760, scheme: "dark", clip: "[class*='card']", transparent: true });
} finally {
  chrome.kill();
}
