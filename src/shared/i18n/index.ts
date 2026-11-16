// UI language. The choice is stored in localStorage (shared by the main window and widget)
// and passed to Rust for the tray menu and the sign-in page in the browser.
// The language is chosen once on page load: after the setting changes, windows reload.
// New language: dictionary in ./xx.ts, a line in LANGUAGES below, phrase parsing in lib/quick-xx.ts.
import { broadcast, inTauri, subscribe } from "../api/bus";
import { readJson, writeJson } from "../lib/storage";
import { en } from "./en";
import { ru, type Dict } from "./ru";
import { uk } from "./uk";
import { be } from "./be";
import { bn } from "./bn";
import { ar } from "./ar";
import { hi } from "./hi";
import { zh } from "./zh";
import { ja } from "./ja";
import { de } from "./de";
import { pt } from "./pt";
import { fr } from "./fr";
import { es } from "./es";

type LangInfo = {
  /** name in the language itself — that's how people look for it in the list */
  name: string;
  dict: Dict;
  /** region for dates if the system doesn't have this language with a region */
  region: string;
  rtl?: boolean;
};

const LANGUAGES = {
  en: { name: "English", dict: en, region: "en-GB" },
  ru: { name: "Русский", dict: ru, region: "ru-RU" },
  uk: { name: "Українська", dict: uk, region: "uk-UA" },
  be: { name: "Беларуская", dict: be, region: "be-BY" },
  es: { name: "Español", dict: es, region: "es-ES" },
  fr: { name: "Français", dict: fr, region: "fr-FR" },
  pt: { name: "Português", dict: pt, region: "pt-BR" },
  de: { name: "Deutsch", dict: de, region: "de-DE" },
  ja: { name: "日本語", dict: ja, region: "ja-JP" },
  zh: { name: "中文（简体）", dict: zh, region: "zh-CN" },
  hi: { name: "हिन्दी", dict: hi, region: "hi-IN" },
  ar: { name: "العربية", dict: ar, region: "ar-EG", rtl: true },
  bn: { name: "বাংলা", dict: bn, region: "bn-BD" },
} satisfies Record<string, LangInfo>;

export type Lang = keyof typeof LANGUAGES;
export type LangSetting = "system" | Lang;

const info = (l: Lang): LangInfo => LANGUAGES[l];

/** Languages in the order of the settings list */
export const LANGS = Object.keys(LANGUAGES) as Lang[];
export const langName = (l: Lang): string => info(l).name;
export const dictOf = (l: Lang): Dict => info(l).dict;

const isLang = (v: unknown): v is Lang => typeof v === "string" && Object.hasOwn(LANGUAGES, v);

const KEY = "calm.lang";
const isSetting = (v: unknown): v is LangSetting => v === "system" || isLang(v);

export const readLangSetting = (): LangSetting => {
  const v = readJson<unknown>(KEY, "system");
  return isSetting(v) ? v : "system";
};

const systemLanguages = (): readonly string[] => {
  if (typeof navigator === "undefined") return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
};

const base = (tag: string): string => tag.toLowerCase().split(/[-_]/)[0];

/** The first system language that has a translation; otherwise English */
export const systemLang = (): Lang => systemLanguages().map(base).find(isLang) ?? "en";

const resolve = (setting: LangSetting): Lang => (setting === "system" ? systemLang() : setting);

/** Events in Google use the Gregorian calendar, even if the region's default is different (ar-SA) */
const gregorian = (tag: string): string => {
  try {
    return new Intl.Locale(tag, { calendar: "gregory" }).toString();
  } catch {
    return tag;
  }
};

/** For dates use the system region if it has this language (en-US — 12-hour clock and week from Sunday,
 *  pt-PT — European Portuguese), otherwise the default region: for English it's the British
 *  variant with 24 hours and Monday. */
const localeFor = (l: Lang): string => gregorian(systemLanguages().find((x) => base(x) === l) ?? info(l).region);

export let lang: Lang = "ru";
export let locale = "ru-RU";
export let t: Dict = ru;

/** Right-to-left script (Arabic) */
export const isRtl = (l: Lang = lang): boolean => info(l).rtl === true;

/** regionLocale — tests only: region regardless of the system */
export const setLang = (l: Lang, regionLocale?: string): void => {
  lang = l;
  locale = regionLocale ?? localeFor(l);
  t = info(l).dict;
  if (typeof document !== "undefined") {
    document.documentElement.lang = l;
    document.documentElement.dir = isRtl(l) ? "rtl" : "ltr";
  }
};

// tests are written against Russian strings; in the app — by setting or system language
setLang(import.meta.env.MODE === "test" ? "ru" : resolve(readLangSetting()));

/** Tell the Rust side the language: tray menu and sign-in page in the browser */
export const syncLangToRust = async (): Promise<void> => {
  if (!inTauri) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_language", { language: lang }).catch(() => {});
};

/** Language change: remember it, tell the other window and reload */
export const saveLangSetting = (setting: LangSetting): void => {
  writeJson(KEY, setting);
  setLang(resolve(setting));
  void syncLangToRust().finally(() => {
    broadcast("lang-changed", setting);
    window.location.reload();
  });
};

/** The language was changed in another window — reload with the new one */
export const followLang = (): (() => void) => {
  const reloadIfChanged = () => resolve(readLangSetting()) !== lang && window.location.reload();
  const onStorage = (e: StorageEvent) => e.key === KEY && reloadIfChanged();
  window.addEventListener("storage", onStorage);
  const off = subscribe("lang-changed", reloadIfChanged);
  return () => {
    window.removeEventListener("storage", onStorage);
    off();
  };
};

/** First day of week by region: 1 — Monday, 0 — Sunday, 6 — Saturday */
export const weekStart = (): number => {
  try {
    const l = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const info = l.getWeekInfo?.() ?? l.weekInfo;
    if (info) return info.firstDay % 7;
  } catch {
    // old engine without weekInfo
  }
  return 1;
};

/** 12-hour time format in this region (en-US) */
export const uses12h = (): boolean => {
  const cycle = new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions().hourCycle;
  return cycle === "h11" || cycle === "h12";
};
