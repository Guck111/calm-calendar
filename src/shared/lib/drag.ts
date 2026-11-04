// Перетаскивание событий в сетке времени: шаг и пересчёт времени
import type { CalendarEvent } from "../api/types";
import { addDays, addMinutes } from "./date";

export const DRAG_STEP = 15;

export type DragMode = "move" | "resize";

export const snap = (minutes: number, step = DRAG_STEP): number => Math.round(minutes / step) * step;

/** Новое время события после перетаскивания; при растягивании длина не меньше одного шага */
export const shiftEvent = (
  e: Pick<CalendarEvent, "start" | "end">,
  mode: DragMode,
  deltaMinutes: number,
  deltaDays: number,
): { start: Date; end: Date } => {
  if (mode === "resize") {
    const end = addMinutes(e.end, deltaMinutes);
    const min = addMinutes(e.start, DRAG_STEP);
    return { start: e.start, end: end < min ? min : end };
  }
  return {
    start: addMinutes(addDays(e.start, deltaDays), deltaMinutes),
    end: addMinutes(addDays(e.end, deltaDays), deltaMinutes),
  };
};
