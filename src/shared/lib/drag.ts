// Dragging events in the time grid: step and time recalculation
import type { CalendarEvent } from "../api/types";
import { addDays, addMinutes } from "./date";

export const DRAG_STEP = 15;

export type DragMode = "move" | "resize";

export const snap = (minutes: number, step = DRAG_STEP): number => Math.round(minutes / step) * step;

/** New event time after dragging; when resizing, the length is at least one step */
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
  const start = addMinutes(deltaDays === 0 ? e.start : addDays(e.start, deltaDays), deltaMinutes);
  const duration = (e.end.getTime() - e.start.getTime()) / 60_000;
  return { start, end: addMinutes(start, duration) };
};
