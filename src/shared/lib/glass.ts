// Эффект стекла. Само размытие включает Rust (Windows DWM), здесь — только
// атрибуты на <html>, по которым CSS делает фон окна полупрозрачным.
import { invoke } from "@tauri-apps/api/core";
import { inTauri, subscribe } from "../api/bus";
import { DEFAULT_QUICK_HOTKEY } from "./hotkeys";

const root = document.documentElement;

const setAttr = (enabled: boolean) => {
  if (enabled) root.dataset.glass = "";
  else delete root.dataset.glass;
};

/** Заметное напоминание: выключено, только видеовстречи, все события со временем */
export type AlertMode = "off" | "calls" | "all";

export type AppSettings = {
  glass: boolean;
  notifications: boolean;
  private_notifications: boolean;
  alerts: AlertMode;
  /** сочетание клавиш для быстрого создания из любого места; null — выключено */
  quick_hotkey: string | null;
};

const OFFLINE_SETTINGS: AppSettings = {
  glass: false,
  notifications: false,
  private_notifications: false,
  alerts: "off",
  quick_hotkey: DEFAULT_QUICK_HOTKEY,
};

export const readSettings = async (): Promise<AppSettings> => {
  if (!inTauri) return OFFLINE_SETTINGS;
  try {
    return { ...OFFLINE_SETTINGS, ...(await invoke<Partial<AppSettings>>("get_settings")) };
  } catch {
    return OFFLINE_SETTINGS;
  }
};

/** Не получилось (сочетание занято другой программой) — исключение, прежнее сочетание остаётся */
export const setQuickHotkey = async (hotkey: string | null): Promise<void> => {
  if (inTauri) await invoke("set_quick_hotkey", { hotkey });
};

export const setAlerts = async (mode: AlertMode): Promise<void> => {
  if (inTauri) await invoke("set_alerts", { mode });
};

export const setPrivateNotifications = async (enabled: boolean): Promise<void> => {
  if (inTauri) await invoke("set_private_notifications", { enabled });
};

/** Виджет на рабочем столе и автозапуск: живут в Rust (окно виджета, реестр или StartupTask) */
export type DesktopState = { widget: boolean; on_top: boolean; autostart: boolean };

const OFFLINE_DESKTOP: DesktopState = { widget: false, on_top: false, autostart: false };

export const readDesktop = async (): Promise<DesktopState> => {
  if (!inTauri) return OFFLINE_DESKTOP;
  try {
    return await invoke<DesktopState>("get_desktop");
  } catch {
    return OFFLINE_DESKTOP;
  }
};

/** что не передано, остаётся как было; галочки в меню трея следуют */
export const setWidget = async (change: { visible?: boolean; onTop?: boolean }): Promise<void> => {
  if (inTauri) await invoke("set_widget", { visible: change.visible, onTop: change.onTop });
};

/** Возвращает, что вышло на деле: автозапуск можно запретить в диспетчере задач */
export const setAutostart = async (enabled: boolean): Promise<boolean> =>
  inTauri ? invoke<boolean>("set_autostart", { enabled }) : false;

export const setNotifications = async (enabled: boolean): Promise<void> => {
  if (inTauri) await invoke("set_notifications", { enabled });
};

export const readGlass = async (): Promise<boolean> => {
  if (!inTauri) return false;
  try {
    const s = await invoke<{ glass: boolean }>("get_settings");
    return s.glass;
  } catch {
    return false;
  }
};

export const setGlass = async (enabled: boolean): Promise<void> => {
  setAttr(enabled);
  if (inTauri) await invoke("set_glass", { enabled });
};

/** Применяет текущую настройку и следит за изменениями из другого окна */
export const initGlass = (onChange?: (enabled: boolean) => void): (() => void) => {
  void readGlass().then((g) => {
    setAttr(g);
    onChange?.(g);
  });
  // Acrylic в Windows гаснет без фокуса — тогда CSS возвращает непрозрачный фон
  const onFocus = () => (root.dataset.focused = "");
  const onBlur = () => delete root.dataset.focused;
  if (document.hasFocus()) onFocus();
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);
  const off = subscribe<boolean>("glass-changed", (g) => {
    setAttr(g);
    onChange?.(g);
  });
  return () => {
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("blur", onBlur);
    off();
  };
};

export const glassSupported = inTauri && navigator.userAgent.includes("Windows");
