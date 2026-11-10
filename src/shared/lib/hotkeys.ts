// Сочетание клавиш на всю Windows: открывает окно быстрого создания поверх любых окон.
// Регистрирует его Rust (src-tauri/src/desktop.rs); список тот же, что QUICK_HOTKEYS в config.rs.

export const QUICK_HOTKEYS = ["ctrl+alt+space", "ctrl+shift+space", "alt+shift+space"] as const;

export type QuickHotkey = (typeof QUICK_HOTKEYS)[number];

export const DEFAULT_QUICK_HOTKEY: QuickHotkey = "ctrl+alt+space";

/** «ctrl+alt+space» → «Ctrl+Alt+Space»: так написано на клавишах */
export const hotkeyLabel = (hotkey: string): string =>
  hotkey
    .split("+")
    .map((k) => k.charAt(0).toUpperCase() + k.slice(1))
    .join("+");
