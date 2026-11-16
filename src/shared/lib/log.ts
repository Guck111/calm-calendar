// Window log: errors go to the shared log file via Rust (src-tauri/src/logging.rs).
// The log doesn't get event titles and descriptions, tokens or addresses: only what broke and where.
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "../api/bus";

export type LogLevel = "error" | "warn" | "info";

/** Error text with stack, nothing extra: Error, a { kind, message } object from Rust, or anything */
export const describeError = (e: unknown): string => {
  // a V8 stack starts with the error text
  if (e instanceof Error) return e.stack ?? e.message;
  if (typeof e === "object" && e !== null && "message" in e) {
    const { kind, message } = e as { kind?: unknown; message?: unknown };
    return kind ? `${String(kind)}: ${String(message)}` : String(message);
  }
  return String(e);
};

// the same error in a loop mustn't flood the log: the same message is written at most once a minute
const recent = new Map<string, number>();
const REPEAT_MS = 60_000;

export const log = (level: LogLevel, message: string, error?: unknown): void => {
  const text = error === undefined ? message : `${message}: ${describeError(error)}`;
  const now = Date.now();
  const last = recent.get(text);
  if (last !== undefined && now - last < REPEAT_MS) return;
  recent.set(text, now);
  if (recent.size > 200) recent.clear();

  if (!inTauri) {
    // in the browser (npm run dev) — just the console
    console[level === "info" ? "log" : level](text);
    return;
  }
  // writing to the log must not crash the window itself
  invoke("log_message", { level, message: text }).catch(() => {});
};

export const logError = (message: string, error?: unknown) => log("error", message, error);
export const logWarn = (message: string, error?: unknown) => log("warn", message, error);
export const logInfo = (message: string) => log("info", message);

/** Unhandled errors and rejected promises of the window go to the log */
export const catchUnhandled = (): void => {
  window.addEventListener("error", (e) => logError("unhandled error", e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => logError("unhandled promise rejection", e.reason));
};

/** Log folder in Explorer */
export const openLogsFolder = (): Promise<void> => (inTauri ? invoke("open_logs") : Promise.resolve());
