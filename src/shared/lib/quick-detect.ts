// Quick add phrase language by its letters: a Russian phrase with an English UI
// is read by the Russian parser. The UI language comes first: Latin script with a Spanish UI stays Spanish.
import type { Lang } from "../i18n";

const LATIN = /\p{Script=Latin}/u;
const CYRILLIC = /\p{Script=Cyrillic}/u;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HAN = /\p{Script=Han}/u;

/** script of each UI language */
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

/** a foreign script — the language of that script; Latin — English */
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

/** Cyrillic: the language by letters found only in it. «ў» is Belarusian, «ї є ґ» are Ukrainian,
 *  «і» — in both, «ы э ъ» — in Russian and Belarusian, «и щ» — in Russian and Ukrainian.
 *  If there aren't enough letters, the UI language stays, rather than Cyrillic meaning Russian. */
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
  // kana exists only in Japanese: ideographs next to it are Japanese too
  if (KANA.test(input)) return "ja";
  if (SCRIPT[ui].test(input)) return CYRILLIC_LANGS.includes(ui) ? cyrillicLang(input, ui) : ui;
  const other = OTHERS.find(([script]) => script.test(input))?.[1] ?? ui;
  return other === "ru" ? cyrillicLang(input, ui) : other;
};
