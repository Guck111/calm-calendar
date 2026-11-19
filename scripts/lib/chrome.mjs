// Headless Chrome driven over the DevTools protocol, for screenshots of the dev server (npm run dev).
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
export const BASE = "http://localhost:1420";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wednesday of the current week, 9:50: morning events visible, a countdown in the widget
export const FAKE_CLOCK = `(() => {
  const Real = Date;
  const now = new Real();
  const wed = new Real(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + 3, 9, 50);
  const offset = wed.getTime() - Real.now();
  class FakeDate extends Real {
    constructor(...a) { a.length ? super(...a) : super(Real.now() + offset); }
    static now() { return Real.now() + offset; }
  }
  globalThis.Date = FakeDate;
  try {
    localStorage.setItem("calm.lang", JSON.stringify("en"));
    // the "What else Calm Calendar can do" card would cover the calendar in every shot
    localStorage.setItem("calm.welcome", "true");
  } catch {}
})();`;

const waitForTargets = async (port) => {
  for (let i = 0; i < 50; i++) {
    try { return await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(200); }
  }
  throw new Error("chrome did not start");
};

/** starts Chrome with the fake clock; returns cdp(method, params), evaluate(expression), close() */
export const launch = async (port) => {
  const profile = mkdtempSync(join(tmpdir(), "calm-shots-"));
  const chrome = spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    "--lang=en-US", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "about:blank",
  ], { stdio: "ignore" });

  const page = (await waitForTargets(port)).find((t) => t.type === "page");
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
  const cdp = (method, params = {}) =>
    new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) =>
    (await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;

  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: FAKE_CLOCK });
  return { cdp, evaluate, close: () => chrome.kill() };
};

/** the bounding box of the first element matching the selector, for Page.captureScreenshot */
export const rectOf = (evaluate, selector) =>
  evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 }; })()`);

/** one window of the app at 2× as PNG data (base64); clip takes just the element matching the selector */
export const capture = async ({ cdp, evaluate }, { path, width, height, scheme, view, style, clip, transparent, before, scale = 2 }) => {
  await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
  await cdp("Emulation.setDefaultBackgroundColorOverride", transparent ? { color: { r: 0, g: 0, b: 0, a: 0 } } : {});
  await cdp("Page.navigate", { url: BASE });
  await sleep(300);
  await evaluate(`localStorage.setItem("calm.view", JSON.stringify("${view ?? "week"}"));
    localStorage.setItem("calm.appearance", JSON.stringify({ style: "${style ?? "classic"}", display: "auto", text: "auto" }))`);
  await cdp("Page.navigate", { url: `${BASE}${path}` });
  await sleep(2500);
  if (before) {
    await before();
    await sleep(800);
  }
  const rect = clip ? await rectOf(evaluate, clip) : undefined;
  const { data } = await cdp("Page.captureScreenshot", { format: "png", ...(rect ? { clip: rect } : {}), captureBeyondViewport: false });
  return { data, width: rect?.width ?? width, height: rect?.height ?? height };
};
