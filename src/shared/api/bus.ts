// Events between windows (main window and widget). In a browser without Tauri — quietly do nothing.
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export type BusEvent = "events-changed" | "auth-changed" | "open-date" | "theme-changed" | "appearance-changed" | "glass-changed" | "open-draft" | "lang-changed" | "alerts-changed" | "agenda-shown" | "quick-shown" | "display-changed";

export const broadcast = (name: BusEvent, payload?: unknown): void => {
  if (inTauri) void emit(name, payload);
};

export const subscribe = <T>(name: BusEvent, handler: (payload: T) => void): (() => void) => {
  if (!inTauri) return () => {};
  const unlisten = listen<T>(name, (e) => handler(e.payload));
  return () => void unlisten.then((off) => off());
};

/** show the main window; date in the "2026-11-04" format opens that day */
export const openMain = (date?: string): void => {
  if (inTauri) {
    void invoke("open_main", { date: date ?? null });
  } else {
    // in the browser the widget is opened via ?window=widget — just go to the calendar
    window.location.href = date ? `/?date=${date}` : "/";
  }
};
