// Разбор события из одной строки: «завтра 19:00 английский 50 мин #личное @Гдыня»
// или по-английски «tomorrow 7pm English class 50 min #personal». Язык — как у интерфейса.
// У каждого языка свой разбор в quick-xx.ts; общая часть — в quick-core.ts.
import { lang as uiLang, t, type Lang } from "../i18n";
import { addDays, formatTime, formatWeekdayDayMonth, startOfDay, toDateKey, toTimeKey } from "./date";
import { normalizeInput, type QuickCalendar, type QuickResult } from "./quick-core";
import { parseQuickEn } from "./quick-en";
import { parseQuickRu } from "./quick-ru";
import { parseQuickAr } from "./quick-ar";
import { parseQuickHi } from "./quick-hi";
import { parseQuickZh } from "./quick-zh";
import { parseQuickJa } from "./quick-ja";
import { parseQuickDe } from "./quick-de";
import { parseQuickPt } from "./quick-pt";
import { parseQuickFr } from "./quick-fr";
import { parseQuickEs } from "./quick-es";

export type { QuickCalendar, QuickResult } from "./quick-core";

type Parser = (input: string, now: Date, calendars: QuickCalendar[]) => QuickResult;

/** Новый язык интерфейса не соберётся без своего разбора */
const PARSERS: Record<Lang, Parser> = {
  en: parseQuickEn,
  ru: parseQuickRu,
  es: parseQuickEs,
  fr: parseQuickFr,
  pt: parseQuickPt,
  de: parseQuickDe,
  ja: parseQuickJa,
  zh: parseQuickZh,
  hi: parseQuickHi,
  ar: parseQuickAr,
};

export const parseQuick = (
  input: string,
  now: Date,
  calendars: QuickCalendar[] = [],
  language: Lang = uiLang,
): QuickResult => PARSERS[language](normalizeInput(input), now, calendars);

/** Черновик формы из разобранной строки */
export const quickToDraft = (r: QuickResult, fallbackCalendarId: string) => ({
  calendarId: r.calendarId ?? fallbackCalendarId,
  title: r.title,
  allDay: r.allDay,
  startDate: toDateKey(r.start),
  startTime: toTimeKey(r.start),
  // в форме последний день события на весь день включительно
  endDate: toDateKey(r.allDay ? addDays(r.end, -1) : r.end),
  endTime: toTimeKey(r.end),
  location: r.location ?? "",
  description: "",
  recurring: false,
});

/** «Чт, 5 ноября · 19:00–19:50» для подсказки под строкой */
export const quickWhen = (r: QuickResult): string => {
  const day = formatWeekdayDayMonth(r.start);
  if (r.allDay) return `${day} · ${t.common.allDayLower}`;
  const nextDay = startOfDay(r.end).getTime() !== startOfDay(r.start).getTime();
  return `${day} · ${formatTime(r.start)}–${formatTime(r.end)}${nextDay ? ` ${t.quick.nextDay}` : ""}`;
};
