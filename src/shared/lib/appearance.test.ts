import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPEARANCE,
  DISPLAY_FONTS,
  FONTS,
  STYLES,
  STYLE_FONTS,
  TEXT_FONTS,
  applyAppearance,
  effectiveFont,
  fontStack,
  parseAppearance,
} from "./appearance";

// <html> без DOM: только то, что трогает applyAppearance
const fakeRoot = () => {
  const props = new Map<string, string>();
  return {
    dataset: {} as DOMStringMap,
    props,
    style: {
      setProperty: (name: string, value: string | null) => void props.set(name, value ?? ""),
      removeProperty: (name: string) => {
        const old = props.get(name) ?? "";
        props.delete(name);
        return old;
      },
    },
  };
};

describe("parseAppearance", () => {
  it("returns the default for nothing saved or garbage", () => {
    expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance("paper")).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance({ style: "neon", display: "comic-sans", text: 5 })).toEqual(DEFAULT_APPEARANCE);
  });

  it("keeps known values and drops unknown ones one by one", () => {
    expect(parseAppearance({ style: "mono", display: "unbounded", text: "inter" })).toEqual({
      style: "mono",
      display: "unbounded",
      text: "inter",
    });
    expect(parseAppearance({ style: "paper", display: "nope" })).toEqual({ style: "paper", display: "auto", text: "auto" });
  });

  it("does not take a display-only font for text", () => {
    expect(parseAppearance({ text: "cormorant" }).text).toBe("auto");
    expect(parseAppearance({ text: "unbounded" }).text).toBe("auto");
    expect(parseAppearance({ display: "cormorant" }).display).toBe("cormorant");
  });
});

describe("fonts", () => {
  it("every style names fonts from the lists", () => {
    for (const style of STYLES) {
      expect(DISPLAY_FONTS).toContain(STYLE_FONTS[style].display);
      expect(TEXT_FONTS).toContain(STYLE_FONTS[style].text);
    }
  });

  it("every font has a stack with the language fallback at the end", () => {
    for (const id of FONTS) expect(fontStack(id)).toMatch(/^".+", var\(--font-fallback\)$/);
  });

  it("the font on screen is the chosen one or the style's", () => {
    const a = { style: "showcase", display: "auto", text: "geist" } as const;
    expect(effectiveFont(a, "display")).toBe("unbounded");
    expect(effectiveFont(a, "text")).toBe("geist");
  });
});

describe("applyAppearance", () => {
  it("classic leaves <html> without data-style and without font overrides", () => {
    const root = fakeRoot();
    root.dataset.style = "paper";
    root.props.set("--font-text", "x");
    applyAppearance(DEFAULT_APPEARANCE, root);
    expect(root.dataset.style).toBeUndefined();
    expect(root.props.size).toBe(0);
  });

  it("sets the style and the chosen fonts; the widget clock follows the heading font", () => {
    const root = fakeRoot();
    applyAppearance({ style: "obsidian", display: "cormorant", text: "auto" }, root);
    expect(root.dataset.style).toBe("obsidian");
    expect(root.props.get("--font-display")).toBe(fontStack("cormorant"));
    expect(root.props.get("--font-clock")).toBe(fontStack("cormorant"));
    expect(root.props.has("--font-text")).toBe(false);
  });

  it("going back to auto removes the override", () => {
    const root = fakeRoot();
    applyAppearance({ style: "mono", display: "inter", text: "inter" }, root);
    applyAppearance({ style: "mono", display: "auto", text: "auto" }, root);
    expect(root.props.size).toBe(0);
  });
});
