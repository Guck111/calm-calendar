// Стиль оформления и шрифты: общие для главного окна, виджета и окон у трея, как тема.
// Стиль — набор переменных CSS в styles/styles.css (атрибут data-style на <html>), у каждого
// стиля светлый и тёмный вариант. Шрифты по умолчанию берутся из стиля; выбранный вручную
// шрифт задаётся переменной --font-display или --font-text прямо на <html>.
import { broadcast, subscribe } from "../api/bus";
import { readJson, writeJson } from "./storage";

export const STYLES = ["classic", "paper", "obsidian", "showcase", "mono"] as const;
export type StyleId = (typeof STYLES)[number];

export const FONTS = ["segoe", "inter", "manrope", "onest", "geist", "geistMono", "unbounded", "cormorant"] as const;
export type FontId = (typeof FONTS)[number];

/** "auto" — шрифт, который задаёт стиль */
export type FontChoice = FontId | "auto";

export type Appearance = { style: StyleId; display: FontChoice; text: FontChoice };

export const DEFAULT_APPEARANCE: Appearance = { style: "classic", display: "auto", text: "auto" };

/** название в списке: имена шрифтов не переводятся */
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

// семейства из пакетов @fontsource-variable (styles/fonts.css), Segoe UI — системный
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

/** шрифты стиля по умолчанию; совпадают с --font-display и --font-text в styles.css */
export const STYLE_FONTS: Record<StyleId, { display: FontId; text: FontId }> = {
  classic: { display: "segoe", text: "segoe" },
  paper: { display: "cormorant", text: "inter" },
  obsidian: { display: "manrope", text: "manrope" },
  showcase: { display: "unbounded", text: "onest" },
  mono: { display: "geistMono", text: "geist" },
};

/** для заголовков и цифр — все шрифты */
export const DISPLAY_FONTS: readonly FontId[] = FONTS;
/** для текста — без широкого Unbounded и тонкого Cormorant: мелкий текст ими читается плохо */
export const TEXT_FONTS: readonly FontId[] = FONTS.filter((f) => f !== "unbounded" && f !== "cormorant");

const KEY = "calm.appearance";

const isStyle = (v: unknown): v is StyleId => STYLES.includes(v as StyleId);
const isChoice = (v: unknown, allowed: readonly FontId[]): v is FontChoice =>
  v === "auto" || allowed.includes(v as FontId);

/** настройка из хранилища или из другого окна; всё незнакомое — по умолчанию */
export const parseAppearance = (v: unknown): Appearance => {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return {
    style: isStyle(o.style) ? o.style : DEFAULT_APPEARANCE.style,
    display: isChoice(o.display, DISPLAY_FONTS) ? o.display : "auto",
    text: isChoice(o.text, TEXT_FONTS) ? o.text : "auto",
  };
};

export const readAppearance = (): Appearance => parseAppearance(readJson<unknown>(KEY, null));

/** значение font-family; запасные шрифты (--font-fallback) зависят от языка интерфейса */
export const fontStack = (id: FontId): string => `${FAMILIES[id]}, var(--font-fallback)`;

/** шрифт, который будет на экране: выбранный или шрифт стиля */
export const effectiveFont = (a: Appearance, role: "display" | "text"): FontId =>
  a[role] === "auto" ? STYLE_FONTS[a.style][role] : (a[role] as FontId);

type Root = {
  dataset: DOMStringMap;
  style: Pick<CSSStyleDeclaration, "setProperty" | "removeProperty">;
};

/** атрибут data-style и выбранные шрифты на <html> */
export const applyAppearance = (a: Appearance, root: Root = document.documentElement): void => {
  if (a.style === "classic") delete root.dataset.style;
  else root.dataset.style = a.style;
  // часы виджета — шрифтом заголовков (в «Классическом» по умолчанию они шрифтом текста)
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

/** стиль или шрифт, выбранные в другом окне */
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
      // испорченное значение — оставляем как есть
    }
  };
  window.addEventListener("storage", onStorage);
  const off = subscribe<unknown>("appearance-changed", apply);
  return () => {
    window.removeEventListener("storage", onStorage);
    off();
  };
};
