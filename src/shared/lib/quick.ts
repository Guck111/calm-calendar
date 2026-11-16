// Parsing an event from one line: «завтра 19:00 английский 50 мин #личное @Гдыня»
// or in English "tomorrow 7pm English class 50 min #personal". The language is the UI one.
// Each language has its own parser in quick-xx.ts; the shared part is in quick-core.ts.
import { lang as uiLang, t, type Lang } from "../i18n";
import { addDays, formatTime, formatWeekdayDayMonth, startOfDay, toDateKey, toTimeKey } from "./date";
import { normalizeInput, type QuickCalendar, type QuickResult } from "./quick-core";
import { parseQuickEn } from "./quick-en";
import { parseQuickRu } from "./quick-ru";
import { parseQuickUk } from "./quick-uk";
import { parseQuickBe } from "./quick-be";
import { parseQuickBn } from "./quick-bn";
import { parseQuickAr } from "./quick-ar";
import { parseQuickHi } from "./quick-hi";
import { parseQuickZh } from "./quick-zh";
import { parseQuickJa } from "./quick-ja";
import { parseQuickDe } from "./quick-de";
import { parseQuickPt } from "./quick-pt";
import { parseQuickFr } from "./quick-fr";
import { parseQuickEs } from "./quick-es";
import { phraseLang } from "./quick-detect";

export type { QuickCalendar, QuickResult } from "./quick-core";

type Parser = (input: string, now: Date, calendars: QuickCalendar[]) => QuickResult;

/** A new UI language won't build without its own parser */
const PARSERS: Record<Lang, Parser> = {
  en: parseQuickEn,
  ru: parseQuickRu,
  uk: parseQuickUk,
  be: parseQuickBe,
  es: parseQuickEs,
  fr: parseQuickFr,
  pt: parseQuickPt,
  de: parseQuickDe,
  ja: parseQuickJa,
  zh: parseQuickZh,
  hi: parseQuickHi,
  ar: parseQuickAr,
  bn: parseQuickBn,
};

export const parseQuick = (
  input: string,
  now: Date,
  calendars: QuickCalendar[] = [],
  language: Lang = uiLang,
): QuickResult => {
  const text = normalizeInput(input);
  return PARSERS[phraseLang(text, language)](text, now, calendars);
};

export const hasValidQuickDate = (r: QuickResult): boolean => !Number.isNaN(r.start.getTime());

/** Form draft from a parsed line */
export const quickToDraft = (r: QuickResult, fallbackCalendarId: string) => {
  const validDate = hasValidQuickDate(r);
  return {
    calendarId: r.calendarId ?? fallbackCalendarId,
    title: r.title,
    allDay: r.allDay,
    startDate: validDate ? toDateKey(r.start) : "",
    startTime: validDate ? toTimeKey(r.start) : "",
    // in the form the last day of an all-day event is inclusive
    endDate: validDate ? toDateKey(r.allDay ? addDays(r.end, -1) : r.end) : "",
    endTime: validDate ? toTimeKey(r.end) : "",
    location: r.location ?? "",
    description: "",
    recurrence: [] as string[],
  };
};

/** «Чт, 5 ноября · 19:00–19:50» for the hint under the input */
export const quickWhen = (r: QuickResult): string => {
  if (!hasValidQuickDate(r)) return t.errors.checkDateTime;
  const day = formatWeekdayDayMonth(r.start);
  if (r.allDay) return `${day} · ${t.common.allDayLower}`;
  const nextDay = startOfDay(r.end).getTime() !== startOfDay(r.start).getTime();
  return `${day} · ${formatTime(r.start)}–${formatTime(r.end)}${nextDay ? ` ${t.quick.nextDay}` : ""}`;
};
