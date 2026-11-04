// События между окнами (главное окно и виджет). В браузере без Tauri — тихо ничего не делаем.
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export type BusEvent = "events-changed" | "auth-changed" | "open-date" | "theme-changed";

export const broadcast = (name: BusEvent, payload?: unknown): void => {
  if (inTauri) void emit(name, payload);
};

export const subscribe = <T>(name: BusEvent, handler: (payload: T) => void): (() => void) => {
  if (!inTauri) return () => {};
  const unlisten = listen<T>(name, (e) => handler(e.payload));
  return () => void unlisten.then((off) => off());
};

/** показать главное окно; date в формате "2026-11-04" открывает этот день */
export const openMain = (date?: string): void => {
  if (inTauri) {
    void invoke("open_main", { date: date ?? null });
  } else {
    // в браузере виджет открыт по ?window=widget — просто переходим в календарь
    window.location.href = date ? `/?date=${date}` : "/";
  }
};
