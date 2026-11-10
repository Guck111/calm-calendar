// Цвета отдельных событий в Google Календаре (colorId 1–11). Оттенки — как в веб-версии Google:
// API отдаёт старую бледную палитру, а пользователь видит эти цвета.
import type { Calendar, CalendarEvent } from "../api/types";

export const EVENT_COLORS: Record<string, string> = {
  "1": "#7986cb", // лаванда
  "2": "#33b679", // шалфей
  "3": "#8e24aa", // виноград
  "4": "#e67c73", // фламинго
  "5": "#f6bf26", // банан
  "6": "#f4511e", // мандарин
  "7": "#039be5", // павлин
  "8": "#616161", // графит
  "9": "#3f51b5", // черника
  "10": "#0b8043", // базилик
  "11": "#d50000", // томат
};

export const COLOR_IDS = Object.keys(EVENT_COLORS);

export const isColorId = (v: unknown): v is string => typeof v === "string" && Object.hasOwn(EVENT_COLORS, v);

const FALLBACK = "#8ab4f8";

/** Цвет события на экране: свой цвет события, иначе цвет календаря */
export const eventColor = (event: Pick<CalendarEvent, "colorId"> | undefined, calendar: Calendar | undefined): string =>
  (event?.colorId && EVENT_COLORS[event.colorId]) || calendar?.color || FALLBACK;
