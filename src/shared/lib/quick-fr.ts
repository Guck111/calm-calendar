// French quick add: "demain 19h cours d'anglais 50 min #perso @Bureau".
import { makeEuParser } from "./quick-eu";

const APOS = "['’]";

export const parseQuickFr = makeEuParser({
  today: `aujourd${APOS}hui|auj`,
  tomorrow: "demain",
  dayAfterTomorrow: "apr[èe]s[-\\s]demain",
  tonight: "ce\\s+soir",
  inN: "dans",
  dayUnit: "jours?",
  weekUnit: "semaines?",
  months: ["janv", "f[ée]v", "mars", "avr", "mai", "juin", "juil", "ao[ûu]", "sept", "oct", "nov", "d[ée]c"],
  ordinal: "er|re|e",
  numericDate: "slash",
  weekdays: ["lun(?:di)?", "mar(?:di)?", "mer(?:credi)?", "jeu(?:di)?", "ven(?:dredi)?", "sam(?:edi)?", "dim(?:anche)?"],
  on: "le|ce",
  nextAfter: "prochain",
  at: "à|a",
  from: "de|entre",
  to: `à|a|et|jusqu${APOS}à`,
  // «19h» — c'est une heure ; une durée s'écrit «pendant 2h» ou «2 heures»
  hourWord: "h",
  hourWordAfterAt: "heures?",
  am: "du\\s+matin",
  pm: `de\\s+l${APOS}apr[èe]s[-\\s]midi|du\\s+soir`,
  noon: "midi",
  midnight: "minuit",
  forWord: "pendant|durant",
  minute: "min(?:utes?)?|mn",
  hour: "h|heures?",
  halfHour: "(?:une\\s+)?demi[-\\s]heure",
  atText: "à",
  prepositions: "à|a|au|le|la|de|du|des|pour|pendant|dans|en",
});
