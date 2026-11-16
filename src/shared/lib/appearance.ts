// Visual style and fonts: shared by the main window, the widget and the tray windows, like the theme.
// A style is a set of CSS variables in styles/styles.css (data-style attribute on <html>), each
// style has a light and a dark variant. Default fonts come from the style; a manually chosen
// font is set by the --font-display or --font-text variable directly on <html>.
import { broadcast, subscribe } from "../api/bus";
import { readJson, writeJson } from "./storage";

export const STYLES = ["classic", "paper", "obsidian", "showcase", "mono"] as const;
export type StyleId = (typeof STYLES)[number];

export const FONTS = ["segoe", "inter", "manrope", "onest", "geist", "geistMono", "unbounded", "cormorant"] as const;
export type FontId = (typeof FONTS)[number];

/** "auto" — the font set by the style */
export type FontChoice = FontId | "auto";

export type Appearance = { style: StyleId; display: FontChoice; text: FontChoice };

export const DEFAULT_APPEARANCE: Appearance = { style: "classic", display: "auto", text: "auto" };

/** name in the list: font names are not translated */
export const FONT_NAMES: Record<FontId, string> = {
  segoe: "Segoe UI",
  inter: "Inter",
  manrope: "Manrope",
  onest: "Onest",
  geist: "Geist",
  geistMono: "Geist Mono",
  unbounded: "Unbounded",
  cormorant: "Cormorant Garamond",
};

// families from @fontsource-variable packages (styles/fonts.css), Segoe UI is a system font
const FAMILIES: Record<FontId, string> = {
  segoe: '"Segoe UI Variable Text", "Segoe UI"',
  inter: '"Inter Variable"',
  manrope: '"Manrope Variable"',
  onest: '"Onest Variable"',
  geist: '"Geist Variable"',
  geistMono: '"Geist Mono Variable"',
  unbounded: '"Unbounded Variable"',
  cormorant: '"Cormorant Garamond Variable"',
};

/** the style's default fonts; match --font-display and --font-text in styles.css */
export const STYLE_FONTS: Record<StyleId, { display: FontId; text: FontId }> = {
  classic: { display: "segoe", text: "segoe" },
  paper: { display: "cormorant", text: "inter" },
  obsidian: { display: "manrope", text: "manrope" },
  showcase: { display: "unbounded", text: "onest" },
  mono: { display: "geistMono", text: "geist" },
};

/** for headings and digits — all fonts */
export const DISPLAY_FONTS: readonly FontId[] = FONTS;
/** for text — without the wide Unbounded and thin Cormorant: small text is hard to read in them */
export const TEXT_FONTS: readonly FontId[] = FONTS.filter((f) => f !== "unbounded" && f !== "cormorant");

const KEY = "calm.appearance";

const isStyle = (v: unknown): v is StyleId => STYLES.includes(v as StyleId);
const isChoice = (v: unknown, allowed: readonly FontId[]): v is FontChoice =>
  v === "auto" || allowed.includes(v as FontId);

/** setting from storage or another window; anything unknown falls back to the default */
export const parseAppearance = (v: unknown): Appearance => {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return {
    style: isStyle(o.style) ? o.style : DEFAULT_APPEARANCE.style,
    display: isChoice(o.display, DISPLAY_FONTS) ? o.display : "auto",
    text: isChoice(o.text, TEXT_FONTS) ? o.text : "auto",
  };
};

export const readAppearance = (): Appearance => parseAppearance(readJson<unknown>(KEY, null));

/** font-family value; fallback fonts (--font-fallback) depend on the UI language */
export const fontStack = (id: FontId): string => `${FAMILIES[id]}, var(--font-fallback)`;

/** the font that will be on screen: the chosen one or the style's font */
export const effectiveFont = (a: Appearance, role: "display" | "text"): FontId =>
  a[role] === "auto" ? STYLE_FONTS[a.style][role] : (a[role] as FontId);

type Root = {
  dataset: DOMStringMap;
  style: Pick<CSSStyleDeclaration, "setProperty" | "removeProperty">;
};

/** data-style attribute and chosen fonts on <html> */
export const applyAppearance = (a: Appearance, root: Root = document.documentElement): void => {
  if (a.style === "classic") delete root.dataset.style;
  else root.dataset.style = a.style;
  // widget clock uses the heading font (in "Classic" it uses the text font by default)
  const fonts: [string, FontChoice][] = [
    ["--font-display", a.display],
    ["--font-clock", a.display],
    ["--font-text", a.text],
  ];
  for (const [prop, choice] of fonts) {
    if (choice === "auto") root.style.removeProperty(prop);
    else root.style.setProperty(prop, fontStack(choice));
  }
};

export const saveAppearance = (a: Appearance): void => {
  writeJson(KEY, a);
  applyAppearance(a);
  broadcast("appearance-changed", a);
};

/** style or font chosen in another window */
export const followAppearance = (onChange?: (a: Appearance) => void): (() => void) => {
  const apply = (v: unknown) => {
    const a = parseAppearance(v);
    applyAppearance(a);
    onChange?.(a);
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY || !e.newValue) return;
    try {
      apply(JSON.parse(e.newValue));
    } catch {
      // corrupted value — leave as is
    }
  };
  window.addEventListener("storage", onStorage);
  const off = subscribe<unknown>("appearance-changed", apply);
  return () => {
    window.removeEventListener("storage", onStorage);
    off();
  };
};
