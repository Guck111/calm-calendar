// Язык фразы быстрого создания по её буквам: русская фраза при английском интерфейсе
// читается русским разбором. Язык интерфейса — первый: латиница при испанском остаётся испанской.
import type { Lang } from "../i18n";

const LATIN = /\p{Script=Latin}/u;
const CYRILLIC = /\p{Script=Cyrillic}/u;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HAN = /\p{Script=Han}/u;

/** письмо каждого языка интерфейса */
const SCRIPT: Record<Lang, RegExp> = {
  en: LATIN,
  es: LATIN,
  fr: LATIN,
  pt: LATIN,
  de: LATIN,
  ru: CYRILLIC,
  uk: CYRILLIC,
  be: CYRILLIC,
  ar: /\p{Script=Arabic}/u,
  hi: /\p{Script=Devanagari}/u,
  bn: /\p{Script=Bengali}/u,
  ja: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u,
  zh: HAN,
};

/** чужое письмо — язык этого письма; латиница — английский */
const OTHERS: [RegExp, Lang][] = [
  [CYRILLIC, "ru"],
  [SCRIPT.ar, "ar"],
  [SCRIPT.hi, "hi"],
  [SCRIPT.bn, "bn"],
  [KANA, "ja"],
  [HAN, "zh"],
  [LATIN, "en"],
];

const CYRILLIC_LANGS: Lang[] = ["ru", "uk", "be"];

/** Кириллица: язык по буквам, которые есть только в нём. «ў» — белорусская, «ї є ґ» — украинские,
 *  «і» — в обоих, «ы э ъ» — в русском и белорусском, «и щ» — в русском и украинском.
 *  Если букв не хватает, остаётся язык интерфейса, а не кириллический — русский. */
const cyrillicLang = (input: string, ui: Lang): Lang => {
  const fits = (l: Lang): boolean => {
    if (l === "ru") return !/[ўіїєґ]/iu.test(input);
    if (l === "uk") return !/[ўыэъ]/iu.test(input);
    return !/[їєґищ]/iu.test(input);
  };
  if (CYRILLIC_LANGS.includes(ui) && fits(ui)) return ui;
  return CYRILLIC_LANGS.find(fits) ?? (CYRILLIC_LANGS.includes(ui) ? ui : "ru");
};

export const phraseLang = (input: string, ui: Lang): Lang => {
  // кана бывает только в японском: иероглифы рядом с ней — тоже японские
  if (KANA.test(input)) return "ja";
  if (SCRIPT[ui].test(input)) return CYRILLIC_LANGS.includes(ui) ? cyrillicLang(input, ui) : ui;
  const other = OTHERS.find(([script]) => script.test(input))?.[1] ?? ui;
  return other === "ru" ? cyrillicLang(input, ui) : other;
};
