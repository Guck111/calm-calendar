// Язык интерфейса. Выбор хранится в localStorage (общий для главного окна и виджета)
// и передаётся в Rust для меню трея и страницы входа в браузере.
// Язык выбирается один раз при загрузке страницы: после смены настройки окна перезагружаются.
// Новый язык: словарь в ./xx.ts, строка в LANGUAGES ниже, разбор строки в lib/quick-xx.ts.
import { broadcast, inTauri, subscribe } from "../api/bus";
import { readJson, writeJson } from "../lib/storage";
import { en } from "./en";
import { ru, type Dict } from "./ru";
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
  /** название на самом языке — так его ищут в списке */
  name: string;
  dict: Dict;
  /** регион для дат, если в системе нет этого языка с регионом */
  region: string;
  rtl?: boolean;
};

const LANGUAGES = {
  en: { name: "English", dict: en, region: "en-GB" },
  ru: { name: "Русский", dict: ru, region: "ru-RU" },
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

/** Языки в порядке списка в настройках */
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

/** Первый из языков системы, на который есть перевод; иначе английский */
export const systemLang = (): Lang => systemLanguages().map(base).find(isLang) ?? "en";

const resolve = (setting: LangSetting): Lang => (setting === "system" ? systemLang() : setting);

/** События в Google — по григорианскому календарю, даже если регион по умолчанию считает иначе (ar-SA) */
const gregorian = (tag: string): string => {
  try {
    return new Intl.Locale(tag, { calendar: "gregory" }).toString();
  } catch {
    return tag;
  }
};

/** Для дат берём регион системы, если в ней есть этот язык (en-US — 12 часов и неделя с воскресенья,
 *  pt-PT — европейский португальский), иначе регион по умолчанию: для английского это британский
 *  вариант с 24 часами и понедельником. */
const localeFor = (l: Lang): string => gregorian(systemLanguages().find((x) => base(x) === l) ?? info(l).region);

export let lang: Lang = "ru";
export let locale = "ru-RU";
export let t: Dict = ru;

/** Письмо справа налево (арабский) */
export const isRtl = (l: Lang = lang): boolean => info(l).rtl === true;

/** regionLocale — только для тестов: регион без оглядки на систему */
export const setLang = (l: Lang, regionLocale?: string): void => {
  lang = l;
  locale = regionLocale ?? localeFor(l);
  t = info(l).dict;
  if (typeof document !== "undefined") {
    document.documentElement.lang = l;
    document.documentElement.dir = isRtl(l) ? "rtl" : "ltr";
  }
};

// тесты пишутся на русских строках; в приложении — по настройке или языку системы
setLang(import.meta.env.MODE === "test" ? "ru" : resolve(readLangSetting()));

/** Сообщить Rust-части язык: меню трея и страница входа в браузере */
export const syncLangToRust = async (): Promise<void> => {
  if (!inTauri) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_language", { language: lang }).catch(() => {});
};

/** Смена языка: запоминаем, сообщаем другому окну и перезагружаемся */
export const saveLangSetting = (setting: LangSetting): void => {
  writeJson(KEY, setting);
  setLang(resolve(setting));
  void syncLangToRust().finally(() => {
    broadcast("lang-changed", setting);
    window.location.reload();
  });
};

/** Язык сменили в другом окне — перезагружаемся с новым */
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

/** Первый день недели по региону: 1 — понедельник, 0 — воскресенье, 6 — суббота */
export const weekStart = (): number => {
  try {
    const l = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const info = l.getWeekInfo?.() ?? l.weekInfo;
    if (info) return info.firstDay % 7;
  } catch {
    // старый движок без weekInfo
  }
  return 1;
};

/** 12-часовой формат времени в этом регионе (en-US) */
export const uses12h = (): boolean => {
  const cycle = new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions().hourCycle;
  return cycle === "h11" || cycle === "h12";
};
