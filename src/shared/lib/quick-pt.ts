// Portuguese quick add: "amanhã 19h aula de inglês 50 min #pessoal @Escritório".
import { makeEuParser } from "./quick-eu";

const AMANHA = "amanh[ãa]";
const FEIRA = "(?:[-\\s]feira)?";

export const parseQuickPt = makeEuParser({
  today: "hoje",
  tomorrow: AMANHA,
  dayAfterTomorrow: `depois\\s+de\\s+${AMANHA}`,
  tonight: "hoje\\s+(?:[àa]\\s+)?noite|esta\\s+noite",
  inN: "em|daqui\\s+a|dentro\\s+de",
  dayUnit: "dias?",
  weekUnit: "semanas?",
  months: ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"],
  of: "de",
  numericDate: "slash",
  weekdays: [
    `seg(?:unda)?${FEIRA}`,
    // «ter» sozinho é o verbo, por isso só «terça»
    `ter[çc]a${FEIRA}`,
    `qua(?:rta)?${FEIRA}`,
    `qui(?:nta)?${FEIRA}`,
    `sex(?:ta)?${FEIRA}`,
    "s[áa]b(?:ado)?",
    "dom(?:ingo)?",
  ],
  on: "na|no|nesta|neste|esta|este",
  nextBefore: "pr[óo]xim[oa]",
  nextAfter: "que\\s+vem",
  at: "[àa]s?",
  from: "das?|de",
  to: "[àa]s?|at[ée]",
  // «19h» é horário; duração é «durante 2h» ou «2 horas»
  hourWord: "h",
  hourWordAfterAt: "horas?",
  am: "da\\s+(?:manh[ãa]|madrugada)",
  pm: "da\\s+(?:tarde|noite)",
  noon: "(?:o\\s+)?meio[-\\s]dia",
  midnight: "(?:a\\s+)?meia[-\\s]noite",
  forWord: "durante|por",
  minute: "min(?:utos?)?|m",
  hour: "h|horas?|hrs?",
  halfHour: "meia\\s+hora",
  atText: "às",
  prepositions: "a|à|às|as|o|na|no|de|da|do|das|em|para|por|ao",
});
