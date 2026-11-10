import { describe, expect, it } from "vitest";
import { DEFAULT_QUICK_HOTKEY, QUICK_HOTKEYS, hotkeyLabel } from "./hotkeys";

describe("global quick add shortcut", () => {
  it("Ctrl+Alt+Space by default, a short list to choose from", () => {
    expect(DEFAULT_QUICK_HOTKEY).toBe("ctrl+alt+space");
    expect(QUICK_HOTKEYS).toContain(DEFAULT_QUICK_HOTKEY);
    expect(new Set(QUICK_HOTKEYS).size).toBe(QUICK_HOTKEYS.length);
  });

  it("the label is written as on the keys", () => {
    expect(hotkeyLabel("ctrl+alt+space")).toBe("Ctrl+Alt+Space");
    expect(hotkeyLabel("alt+shift+k")).toBe("Alt+Shift+K");
  });
});
