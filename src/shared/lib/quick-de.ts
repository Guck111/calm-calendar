// German quick add: "morgen 19 Uhr Englischkurs 50 min #privat @Büro".
import { makeEuParser } from "./quick-eu";

export const parseQuickDe = makeEuParser({
  today: "heute",
  // «heute Morgen» — это утро сегодня, а не «завтра»
  tomorrow: "(?<!heute\\s+)morgen",
  dayAfterTomorrow: "[üu]e?bermorgen",
  tonight: "heute\\s+abend",
  inN: "in",
  dayUnit: "tag(?:e|en)?",
  weekUnit: "wochen?",
  months: ["j[äa]n", "feb", "m[äa]r", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "dez"],
  numericDate: "dot",
  weekdays: [
    "mo(?:ntag)?\\.?",
    "di(?:enstag)?\\.?",
    "mi(?:ttwoch)?\\.?",
    "do(?:nnerstag)?\\.?",
    "fr(?:eitag)?\\.?",
    "sa(?:mstag)?\\.?|sonnabend",
    // «so» без точки — обычное слово
    "sonntag|so\\.",
  ],
  on: "am|diesen|kommenden",
  nextBefore: "n[äa]chste[nrms]?",
  at: "um",
  from: "von|ab",
  to: "bis",
  hourWord: "uhr",
  am: "morgens|vormittags|fr[üu]h",
  pm: "nachmittags|abends|nachts",
  noon: "mittags",
  midnight: "mitternacht",
  forWord: "f[üu]r",
  minute: "min(?:uten?)?\\.?|m",
  hour: "h|std\\.?|stunden?",
  halfHour: "(?:eine\\s+)?halbe\\s+stunde",
  atText: "um",
  prepositions: "am|um|im|in|an|von|bis|f[üu]r|zum|zur",
});
