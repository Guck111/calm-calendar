// The list of keyboard shortcuts on "?": groups, keys, the global quick add shortcut as set in Settings
import { describe, expect, it } from "vitest";
import { shortcutGroups } from "./shortcuts";
import { t } from "../i18n";

const keysOf = (hotkey: string | null) => shortcutGroups(hotkey).flatMap((g) => g.items.flatMap((i) => i.keys.flat()));

describe("keyboard shortcuts list", () => {
  it("four groups, every item has a label and keys", () => {
    const groups = shortcutGroups("ctrl+alt+space");
    expect(groups.map((g) => g.title)).toEqual([
      t.shortcuts.calendar,
      t.shortcuts.create,
      t.shortcuts.onEvent,
      t.shortcuts.anywhere,
    ]);
    for (const item of groups.flatMap((g) => g.items)) {
      expect(item.label).not.toBe("");
      expect(item.keys.length).toBeGreaterThan(0);
    }
  });

  it("the main keys are there", () => {
    expect(keysOf("ctrl+alt+space")).toEqual(expect.arrayContaining(["Ctrl", "K", "E", "Delete", "?", "T", "N"]));
  });

  it("the global shortcut as chosen in Settings; none when it is off", () => {
    expect(keysOf("ctrl+shift+space")).toEqual(expect.arrayContaining(["Ctrl", "Shift", "Space"]));
    const labels = (h: string | null) => shortcutGroups(h).flatMap((g) => g.items.map((i) => i.label));
    expect(labels("ctrl+alt+space")).toContain(t.shortcuts.fromAnywhere);
    expect(labels(null)).not.toContain(t.shortcuts.fromAnywhere);
  });
});
