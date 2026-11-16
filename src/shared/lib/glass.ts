// Glass effect. Rust turns on the blur itself (Windows DWM); here only
// the attributes on <html> that CSS uses to make the window background translucent.
import { invoke } from "@tauri-apps/api/core";
import { inTauri, subscribe } from "../api/bus";
import { DEFAULT_QUICK_HOTKEY } from "./hotkeys";

const root = document.documentElement;

const setAttr = (enabled: boolean) => {
  if (enabled) root.dataset.glass = "";
  else delete root.dataset.glass;
};

/** Prominent reminder: off, video meetings only, all timed events */
export type AlertMode = "off" | "calls" | "all";

export type AppSettings = {
  glass: boolean;
  notifications: boolean;
  private_notifications: boolean;
  alerts: AlertMode;
  /** hotkey for quick add from anywhere; null — off */
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

/** Failed (the hotkey is taken by another program) — an exception, the previous hotkey stays */
export const setQuickHotkey = async (hotkey: string | null): Promise<void> => {
  if (inTauri) await invoke("set_quick_hotkey", { hotkey });
};

export const setAlerts = async (mode: AlertMode): Promise<void> => {
  if (inTauri) await invoke("set_alerts", { mode });
};

export const setPrivateNotifications = async (enabled: boolean): Promise<void> => {
  if (inTauri) await invoke("set_private_notifications", { enabled });
};

/** Desktop widget and autostart: live in Rust (widget window, registry or StartupTask) */
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

/** whatever isn't passed stays as it was; the tray menu checkboxes follow */
export const setWidget = async (change: { visible?: boolean; onTop?: boolean }): Promise<void> => {
  if (inTauri) await invoke("set_widget", { visible: change.visible, onTop: change.onTop });
};

/** Returns what actually happened: autostart can be disabled in Task Manager */
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

/** Applies the current setting and watches for changes from another window */
export const initGlass = (onChange?: (enabled: boolean) => void): (() => void) => {
  void readGlass().then((g) => {
    setAttr(g);
    onChange?.(g);
  });
  // Acrylic in Windows fades without focus — then CSS restores an opaque background
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
