// Государственные праздники: публичные календари Google вида «ru.russian#holiday@group.v.calendar.google.com».
// Их можно читать с правом calendar.events, а добавить в список календарей Google нельзя без нового права,
// поэтому выбранная страна хранится только в приложении. Первая часть id — язык названий праздников.
import { calendarRef } from "../api/calendar";
import type { Calendar } from "../api/types";
import { lang, locale } from "../i18n";

/** выбранная страна в localStorage: её читают и главное окно, и виджет */
export const HOLIDAYS_KEY = "calm.holidays";

/** цвет праздников, как у календарей праздников в Google */
const HOLIDAY_COLOR = "#16a765";

/** страна (ISO 3166) → имя календаря у Google; проверено, что каждый календарь существует */
export const HOLIDAY_REGIONS: Record<string, string> = {
  AE: "ae", AM: "am", AR: "ar", AT: "austrian", AU: "australian", BD: "bd", BE: "be", BG: "bulgarian",
  BR: "brazilian", BY: "by", CA: "canadian", CH: "ch", CL: "cl", CN: "china", CO: "co", CY: "cy", CZ: "czech",
  DE: "german", DK: "danish", EC: "ec", EE: "ee", EG: "eg", ES: "spain", FI: "finnish", FR: "french", GB: "uk",
  GE: "ge", GR: "greek", HK: "hong_kong", HR: "croatian", HU: "hungarian", ID: "indonesian", IE: "irish",
  IL: "jewish", IN: "indian", IS: "is", IT: "italian", JP: "japanese", KE: "ke", KR: "south_korea", KZ: "kz",
  LT: "lithuanian", LU: "lu", LV: "latvian", MA: "ma", MD: "md", MX: "mexican", MY: "malaysia", NG: "ng",
  NL: "dutch", NO: "norwegian", NZ: "new_zealand", PE: "pe", PH: "philippines", PK: "pk", PL: "polish",
  PT: "portuguese", RO: "romanian", RS: "rs", RU: "russian", SA: "saudiarabian", SE: "swedish", SG: "singapore",
  SI: "slovenian", SK: "slovak", TH: "th", TR: "turkish", TW: "taiwan", UA: "ukrainian", US: "usa", UY: "uy",
  UZ: "uz", VE: "ve", VN: "vietnamese", ZA: "sa",
};

export const isHolidayRegion = (v: unknown): v is string => typeof v === "string" && v in HOLIDAY_REGIONS;

/** id календаря праздников страны с названиями на языке приложения */
export const holidayCalendarId = (region: string, language: string = lang): string =>
  `${language}.${HOLIDAY_REGIONS[region]}#holiday@group.v.calendar.google.com`;

/** «Польша», «Poland» — на языке приложения */
export const regionName = (region: string): string => {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(region) ?? region;
  } catch {
    return region;
  }
};

/** страны по алфавиту языка приложения */
export const sortedRegions = (): { region: string; name: string }[] =>
  Object.keys(HOLIDAY_REGIONS)
    .map((region) => ({ region, name: regionName(region) }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));

/** страна из региона системы: предлагаем её первой */
export const systemRegion = (): string | null => {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    return region && isHolidayRegion(region) ? region : null;
  } catch {
    return null;
  }
};

/** Календарь праздников страны из настроек. Читаем через первый аккаунт; если такой календарь
 *  уже есть в списке Google, второй раз не добавляем */
export const holidayCalendar = (region: string | null, accounts: string[], google: Calendar[]): Calendar | null => {
  if (!region || !isHolidayRegion(region) || !accounts.length) return null;
  const slug = `.${HOLIDAY_REGIONS[region]}#holiday@`;
  if (google.some((c) => c.googleId.includes(slug))) return null;
  const googleId = holidayCalendarId(region);
  return {
    id: calendarRef(accounts[0], googleId),
    googleId,
    account: accounts[0],
    name: regionName(region),
    color: HOLIDAY_COLOR,
    textColor: "#000000",
    accessRole: "reader",
    primary: false,
    selected: true,
    defaultReminders: [],
    holiday: true,
  };
};
