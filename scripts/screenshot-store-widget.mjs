// Store widget image: light and dark widget side by side, 2880x1800.
// Needs the dev server on :1420. Usage: node scripts/screenshot-store-widget.mjs docs/store/screenshot-widget-store.png
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUT = process.argv[2];
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9334;
const profile = mkdtempSync(join(tmpdir(), "calm-store-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--lang=en-US", "--hide-scrollbars", "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let targets;
for (let i = 0; i < 50 && !targets; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch { await sleep(200); }
}
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
});
const cdp = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => (await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;

const FAKE_CLOCK = `(() => {
  const Real = Date; const now = new Real();
  const wed = new Real(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + 3, 9, 50);
  const offset = wed.getTime() - Real.now();
  class FakeDate extends Real { constructor(...a) { a.length ? super(...a) : super(Real.now() + offset); } static now() { return Real.now() + offset; } }
  globalThis.Date = FakeDate;
  try { localStorage.setItem("calm.lang", JSON.stringify("en")); } catch {}
})();`;

const W = 375; // widget width on the Store image, CSS px at scale 2
try {
  await cdp("Page.enable");
  await cdp("Runtime.enable");
  const { identifier } = await cdp("Page.addScriptToEvaluateOnNewDocument", { source: FAKE_CLOCK });
  const shots = {};
  for (const scheme of ["light", "dark"]) {
    // widget is 300 CSS px wide; scale 2.5 gives 750 px = 375 CSS px at scale 2
    await cdp("Emulation.setDeviceMetricsOverride", { width: 340, height: 760, deviceScaleFactor: 2.5, mobile: false });
    await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
    await cdp("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
    await cdp("Page.navigate", { url: "http://localhost:1420/?window=widget" });
    await sleep(2500);
    const rect = await evaluate(`(() => { const r = document.querySelector("[class*='card']").getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 }; })()`);
    shots[scheme] = { data: (await cdp("Page.captureScreenshot", { format: "png", clip: rect })).data, w: rect.width, h: rect.height };
  }
  await cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
  await cdp("Emulation.setDefaultBackgroundColorOverride", {});
  await cdp("Page.navigate", { url: "about:blank" });
  await sleep(300);
  const img = (s) => `<img src="data:image/png;base64,${s.data}" style="width:${s.w * 1.25}px;height:${s.h * 1.25}px;display:block">`;
  const html = `<body style="margin:0;width:1440px;height:900px;background:#E4ECF7;display:flex;align-items:center;justify-content:center;gap:56px">${img(shots.light)}${img(shots.dark)}</body>`;
  await evaluate(`document.open(); document.write(${JSON.stringify(html)}); document.close(); new Promise(r => setTimeout(r, 500))`);
  const { data } = await cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(OUT, Buffer.from(data, "base64"));
  console.log("saved", OUT, "widget", shots.light.w, "x", shots.light.h);
} finally {
  chrome.kill();
}
