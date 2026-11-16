// Public holidays: public Google calendars like "ru.russian#holiday@group.v.calendar.google.com".
// They can be read with the calendar.events scope, but can't be added to the Google calendar list without a new scope,
// so the chosen country is stored only in the app. The first part of the id is the language of holiday names.
import { calendarRef } from "../api/calendar";
import type { Calendar } from "../api/types";
import { lang, locale } from "../i18n";

/** chosen country in localStorage: read by both the main window and the widget */
export const HOLIDAYS_KEY = "calm.holidays";

/** holiday color, as for Google holiday calendars */
const HOLIDAY_COLOR = "#16a765";

/** country (ISO 3166) → Google calendar name; verified that each calendar exists */
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

/** id of the country's holiday calendar with names in the app language */
export const holidayCalendarId = (region: string, language: string = lang): string =>
  `${language}.${HOLIDAY_REGIONS[region]}#holiday@group.v.calendar.google.com`;

/** «Польша», "Poland" — in the app language */
export const regionName = (region: string): string => {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(region) ?? region;
  } catch {
    return region;
  }
};

/** countries in the alphabetical order of the app language */
export const sortedRegions = (): { region: string; name: string }[] =>
  Object.keys(HOLIDAY_REGIONS)
    .map((region) => ({ region, name: regionName(region) }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));

/** Holiday calendar of the country from settings. Read via the first account; if such a calendar
 *  is already in the Google list, don't add it a second time */
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
