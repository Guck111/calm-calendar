// Starts the real app (debug build with mock data, npm run build:app-e2e) under tauri-driver and
// msedgedriver, and gives a WebdriverIO session. The app has its own identifier
// (com.arseni.calmcalendar.e2e): its settings, WebView data and log are apart from the installed app,
// and it never talks to Google.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { remote } from "webdriverio";

const ROOT = resolve(import.meta.dirname, "../..");
const APP = join(ROOT, "src-tauri", "target", "debug", "calm-calendar.exe");
const NATIVE_DRIVER = join(ROOT, "e2e", ".drivers", "msedgedriver.exe");
const IDENTIFIER = "com.arseni.calmcalendar.e2e";
const PORT = 4444;

export const CONFIG_DIR = join(process.env.APPDATA ?? "", IDENTIFIER);
export const DATA_DIR = join(process.env.LOCALAPPDATA ?? "", IDENTIFIER);
export const LOG_FILE = join(DATA_DIR, "logs", "calm-calendar.log");

const portOpen = () =>
  new Promise((done) => {
    const socket = connect(PORT, "127.0.0.1");
    socket.once("connect", () => (socket.end(), done(true)));
    socket.once("error", () => done(false));
  });

/** Settings, WebView storage and log of the test app start empty. Only the test app's own folders */
export const resetAppData = ({ widget = false } = {}) => {
  rmSync(CONFIG_DIR, { recursive: true, force: true });
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(CONFIG_DIR, { recursive: true });
  if (widget) writeFileSync(join(CONFIG_DIR, "widget.json"), JSON.stringify({ visible: true, on_top: false }));
};

/** Start the app; env goes to the app process (CALM_DEMO_ALERT, CALM_DEMO_AGENDA) */
export const startApp = async (env = {}) => {
  for (const [file, hint] of [
    [APP, "npm run build:app-e2e"],
    [NATIVE_DRIVER, "powershell -ExecutionPolicy Bypass -File scripts/msedgedriver.ps1"],
  ]) {
    if (!existsSync(file)) throw new Error(`${file} is missing. Run: ${hint}`);
  }
  const driver = spawn("tauri-driver", ["--port", String(PORT), "--native-driver", NATIVE_DRIVER], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "ignore", "inherit"],
  });
  for (let i = 0; !(await portOpen()); i++) {
    if (i > 50) throw new Error("tauri-driver did not start");
    await sleep(200);
  }
  const browser = await remote({
    hostname: "127.0.0.1",
    port: PORT,
    logLevel: "warn",
    capabilities: { browserName: "wry", "tauri:options": { application: APP } },
  });
  const stop = async () => {
    await browser.deleteSession().catch(() => {});
    driver.kill();
    // the app may outlive the session for a moment: wait until its files are free
    await sleep(1000);
  };
  return { browser, stop };
};

/** Switch to one of the app's windows: "main", "widget", "alert" or "agenda" (the ?window= of its page) */
export const switchToWindow = async (browser, kind, timeout = 20_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const handle of await browser.getWindowHandles()) {
      await browser.switchToWindow(handle);
      const url = await browser.getUrl();
      const found = new URL(url).searchParams.get("window") ?? "main";
      if (found === kind) return handle;
    }
    await sleep(500);
  }
  throw new Error(`no "${kind}" window`);
};

/** English interface in the current window: the language is in localStorage, shared by all windows */
export const useEnglish = async (browser) => {
  const lang = await browser.execute(() => localStorage.getItem("calm.lang"));
  if (lang === '"en"') return;
  await browser.execute(() => localStorage.setItem("calm.lang", '"en"'));
  await browser.refresh();
};

/** Wait for an element that matches a CSS selector and has this text */
export const waitForText = (browser, selector, text, timeout = 15_000) =>
  browser.waitUntil(
    () =>
      browser.execute(
        (sel, want) => [...document.querySelectorAll(sel)].some((el) => el.textContent?.includes(want)),
        selector,
        text,
      ),
    { timeout, timeoutMsg: `no ${selector} with "${text}"` },
  );

export const readLog = () => (existsSync(LOG_FILE) ? readFileSync(LOG_FILE, "utf8") : "");
