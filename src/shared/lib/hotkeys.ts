// System-wide Windows hotkey: opens the quick add window on top of any windows.
// Rust registers it (src-tauri/src/desktop.rs); the list is the same as QUICK_HOTKEYS in config.rs.

export const QUICK_HOTKEYS = ["ctrl+alt+space", "ctrl+shift+space", "alt+shift+space"] as const;

export type QuickHotkey = (typeof QUICK_HOTKEYS)[number];

export const DEFAULT_QUICK_HOTKEY: QuickHotkey = "ctrl+alt+space";

/** "ctrl+alt+space" → "Ctrl+Alt+Space": as written on the keys */
export const hotkeyLabel = (hotkey: string): string =>
  hotkey
    .split("+")
    .map((k) => k.charAt(0).toUpperCase() + k.slice(1))
    .join("+");
