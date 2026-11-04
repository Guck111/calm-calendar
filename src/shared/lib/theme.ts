// Тема оформления: общая для главного окна и виджета
import { broadcast, inTauri, subscribe } from "../api/bus";
import { readJson, writeJson } from "./storage";

export type Theme = "system" | "light" | "dark";

const KEY = "calm.theme";
const isTheme = (v: unknown): v is Theme => v === "system" || v === "light" || v === "dark";

export const readTheme = (): Theme => {
  const v = readJson<unknown>(KEY, "system");
  return isTheme(v) ? v : "system";
};

export const nextTheme = (t: Theme): Theme => (t === "system" ? "light" : t === "light" ? "dark" : "system");

export const themeLabel: Record<Theme, string> = {
  system: "как в системе",
  light: "светлая",
  dark: "тёмная",
};

/** атрибут на <html> для CSS и тема заголовка окна Windows */
export const applyTheme = (t: Theme): void => {
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  if (inTauri) {
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
      getCurrentWindow()
        .setTheme(t === "system" ? null : t)
        .catch(() => {}),
    );
  }
};

export const saveTheme = (t: Theme): void => {
  writeJson(KEY, t);
  applyTheme(t);
  broadcast("theme-changed", t);
};

/** тема, выбранная в другом окне */
export const followTheme = (onChange?: (t: Theme) => void): (() => void) => {
  const apply = (t: unknown) => {
    if (!isTheme(t)) return;
    applyTheme(t);
    onChange?.(t);
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY && e.newValue) apply(JSON.parse(e.newValue));
  };
  window.addEventListener("storage", onStorage);
  const off = subscribe<Theme>("theme-changed", apply);
  return () => {
    window.removeEventListener("storage", onStorage);
    off();
  };
};
