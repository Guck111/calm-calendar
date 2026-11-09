// Журнал работы окон: ошибки уходят в общий файл журнала через Rust (src-tauri/src/logging.rs).
// В журнал не пишем названия и описания событий, токены и адреса: только что сломалось и где.
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "../api/bus";

export type LogLevel = "error" | "warn" | "info";

/** Текст ошибки со стеком, без лишнего: Error, объект { kind, message } из Rust или что угодно */
export const describeError = (e: unknown): string => {
  // стек V8 начинается с текста ошибки
  if (e instanceof Error) return e.stack ?? e.message;
  if (typeof e === "object" && e !== null && "message" in e) {
    const { kind, message } = e as { kind?: unknown; message?: unknown };
    return kind ? `${String(kind)}: ${String(message)}` : String(message);
  }
  return String(e);
};

// одинаковая ошибка в цикле не должна забить журнал: одно и то же сообщение пишем не чаще раза в минуту
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
    // в браузере (npm run dev) — просто консоль
    console[level === "info" ? "log" : level](text);
    return;
  }
  // запись в журнал не должна сама ронять окно
  invoke("log_message", { level, message: text }).catch(() => {});
};

export const logError = (message: string, error?: unknown) => log("error", message, error);
export const logWarn = (message: string, error?: unknown) => log("warn", message, error);
export const logInfo = (message: string) => log("info", message);

/** Необработанные ошибки и отклонённые обещания окна — в журнал */
export const catchUnhandled = (): void => {
  window.addEventListener("error", (e) => logError("unhandled error", e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => logError("unhandled promise rejection", e.reason));
};

/** Папка с журналом в Проводнике */
export const openLogsFolder = (): Promise<void> => (inTauri ? invoke("open_logs") : Promise.resolve());
