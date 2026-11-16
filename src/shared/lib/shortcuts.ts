// Keyboard shortcut list for the "?" window: groups, labels in the UI language and the keys themselves.
// Keys as on the keyboard; one action may have several variants (Ctrl+F or /).
import { t } from "../i18n";
import { hotkeyLabel } from "./hotkeys";

/** keys — variants, each variant is keys pressed together */
export type ShortcutItem = { label: string; keys: string[][] };
export type ShortcutGroup = { title: string; items: ShortcutItem[] };

/** quickHotkey — the quick add hotkey from settings ("ctrl+alt+space"); null — off */
export const shortcutGroups = (quickHotkey: string | null): ShortcutGroup[] => {
  const s = t.shortcuts;
  return [
    {
      title: s.calendar,
      items: [
        { label: s.prevNext, keys: [["←"], ["→"]] },
        { label: s.today, keys: [["T"]] },
        { label: s.views, keys: [["D"], ["W"], ["M"], ["A"]] },
      ],
    },
    {
      title: s.create,
      items: [
        { label: s.quickAdd, keys: [["N"]] },
        { label: s.quickCreate, keys: [["Enter"]] },
        { label: s.quickForm, keys: [["Ctrl", "Enter"]] },
        ...(quickHotkey ? [{ label: s.fromAnywhere, keys: [hotkeyLabel(quickHotkey).split("+")] }] : []),
      ],
    },
    {
      title: s.onEvent,
      items: [
        { label: s.pick, keys: [["↓"], ["↑"]] },
        { label: s.move, keys: [["←", "↑", "↓", "→"]] },
        { label: s.open, keys: [["Enter"]] },
        { label: s.edit, keys: [["E"]] },
        { label: s.duplicate, keys: [["Ctrl", "D"]] },
        { label: s.delete, keys: [["Delete"]] },
      ],
    },
    {
      title: s.anywhere,
      items: [
        { label: s.commands, keys: [["Ctrl", "K"]] },
        { label: s.undoLast, keys: [["Ctrl", "Z"]] },
        { label: s.search, keys: [["Ctrl", "F"], ["/"]] },
        { label: s.close, keys: [["Esc"]] },
        { label: s.help, keys: [["?"]] },
      ],
    },
  ];
};
