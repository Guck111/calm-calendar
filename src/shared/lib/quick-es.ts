// Spanish quick add: "mañana a las 19:00 clase de inglés 50 min #personal @Oficina".
import { makeEuParser } from "./quick-eu";

const MAÑANA = "ma[ñn]ana";

export const parseQuickEs = makeEuParser({
  today: "hoy",
  // «de la mañana», «por la mañana» — это утро, а не «завтра»
  tomorrow: `(?<!(?:de|por)\\s+la\\s+)${MAÑANA}`,
  dayAfterTomorrow: `pasado\\s+${MAÑANA}`,
  tonight: "esta\\s+noche|hoy\\s+por\\s+la\\s+noche",
  inN: "en|dentro\\s+de",
  dayUnit: "d[ií]as?",
  weekUnit: "semanas?",
  months: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"],
  of: "de|del",
  numericDate: "slash",
  weekdays: [
    "lun(?:es)?",
    "mar(?:tes)?",
    "mi[ée]rcoles|mi[ée]",
    "jue(?:ves)?",
    "vie(?:rnes)?",
    "s[áa]bado|s[áa]b",
    "domingo|dom",
  ],
  on: "el|este",
  nextBefore: "pr[óo]xim[oa]",
  nextAfter: "que\\s+viene",
  at: "a\\s+las?",
  from: "de|desde",
  to: "a|hasta",
  // «2h» por sí solo es una duración; «a las 19h» es una hora
  hourWord: "(?!)",
  hourWordAfterAt: "h|hs|horas?",
  am: `(?:de|por)\\s+la\\s+(?:${MAÑANA}|madrugada)`,
  pm: "(?:de|por)\\s+la\\s+(?:tarde|noche)|del\\s+mediod[ií]a",
  noon: "(?:al\\s+|el\\s+)?mediod[ií]a",
  midnight: "(?:la\\s+)?medianoche",
  forWord: "durante|por",
  minute: "min(?:utos?)?|m",
  hour: "h(?:oras?)?|hrs?",
  halfHour: "media\\s+hora",
  atText: "a las",
  prepositions: "a|en|el|la|las|de|del|desde|hasta|para|por",
});
