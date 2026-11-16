// Colors of individual events in Google Calendar (colorId 1–11). Shades as in Google's web version:
// the API returns the old pale palette, while the user sees these colors.
import type { Calendar, CalendarEvent } from "../api/types";

export const EVENT_COLORS: Record<string, string> = {
  "1": "#7986cb", // lavender
  "2": "#33b679", // sage
  "3": "#8e24aa", // grape
  "4": "#e67c73", // flamingo
  "5": "#f6bf26", // banana
  "6": "#f4511e", // tangerine
  "7": "#039be5", // peacock
  "8": "#616161", // graphite
  "9": "#3f51b5", // blueberry
  "10": "#0b8043", // basil
  "11": "#d50000", // tomato
};

export const COLOR_IDS = Object.keys(EVENT_COLORS);

export const isColorId = (v: unknown): v is string => typeof v === "string" && Object.hasOwn(EVENT_COLORS, v);

const FALLBACK = "#8ab4f8";

/** Event color on screen: the event's own color, otherwise the calendar color */
export const eventColor = (event: Pick<CalendarEvent, "colorId"> | undefined, calendar: Calendar | undefined): string =>
  (event?.colorId && EVENT_COLORS[event.colorId]) || calendar?.color || FALLBACK;
