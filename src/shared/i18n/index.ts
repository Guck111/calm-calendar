// Язык интерфейса: русский или английский. Выбор хранится в localStorage (общий для главного
// окна и виджета) и передаётся в Rust для меню трея и страницы входа в браузере.
// Язык выбирается один раз при загрузке страницы: после смены настройки окна перезагружаются.
import { broadcast, inTauri, subscribe } from "../api/bus";
import { readJson, writeJson } from "../lib/storage";
import { en } from "./en";
import { ru, type Dict } from "./ru";

export type Lang = "ru" | "en";
export type LangSetting = "system" | Lang;

const KEY = "calm.lang";
const isSetting = (v: unknown): v is LangSetting => v === "system" || v === "ru" || v === "en";

export const readLangSetting = (): LangSetting => {
  const v = readJson<unknown>(KEY, "system");
  return isSetting(v) ? v : "system";
};

const systemLanguages = (): readonly string[] => {
  if (typeof navigator === "undefined") return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
};

export const systemLang = (): Lang => (systemLanguages()[0]?.toLowerCase().startsWith("ru") ? "ru" : "en");

const resolve = (setting: LangSetting): Lang => (setting === "system" ? systemLang() : setting);

/** Для дат: английский берём с регионом системы (en-US — 12 часов и неделя с воскресенья),
 *  а если система не английская — британский вариант с 24 часами и понедельником. */
const localeFor = (l: Lang): string =>
  l === "ru" ? "ru-RU" : (systemLanguages().find((x) => x.toLowerCase().startsWith("en")) ?? "en-GB");

const DICTS: Record<Lang, Dict> = { ru, en };

export let lang: Lang = "ru";
export let locale = "ru-RU";
export let t: Dict = ru;

/** regionLocale — только для тестов: регион без оглядки на систему */
export const setLang = (l: Lang, regionLocale?: string): void => {
  lang = l;
  locale = regionLocale ?? localeFor(l);
  t = DICTS[l];
  if (typeof document !== "undefined") document.documentElement.lang = l;
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

/** Первый день недели по региону: 1 — понедельник, 0 — воскресенье */
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
