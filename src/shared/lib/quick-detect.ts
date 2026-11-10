// Язык фразы быстрого создания по её буквам: русская фраза при английском интерфейсе
// читается русским разбором. Язык интерфейса — первый: латиница при испанском остаётся испанской.
import type { Lang } from "../i18n";

const LATIN = /\p{Script=Latin}/u;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HAN = /\p{Script=Han}/u;

/** письмо каждого языка интерфейса */
const SCRIPT: Record<Lang, RegExp> = {
  en: LATIN,
  es: LATIN,
  fr: LATIN,
  pt: LATIN,
  de: LATIN,
  ru: /\p{Script=Cyrillic}/u,
  ar: /\p{Script=Arabic}/u,
  hi: /\p{Script=Devanagari}/u,
  bn: /\p{Script=Bengali}/u,
  ja: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u,
  zh: HAN,
};

/** чужое письмо — язык этого письма; латиница — английский */
const OTHERS: [RegExp, Lang][] = [
  [SCRIPT.ru, "ru"],
  [SCRIPT.ar, "ar"],
  [SCRIPT.hi, "hi"],
  [SCRIPT.bn, "bn"],
  [KANA, "ja"],
  [HAN, "zh"],
  [LATIN, "en"],
];

export const phraseLang = (input: string, ui: Lang): Lang => {
  // кана бывает только в японском: иероглифы рядом с ней — тоже японские
  if (KANA.test(input)) return "ja";
  if (SCRIPT[ui].test(input)) return ui;
  return OTHERS.find(([script]) => script.test(input))?.[1] ?? ui;
};
