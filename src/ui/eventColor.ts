import type { CSSProperties } from "react";
import type { Calendar, CalendarEvent } from "../shared/api/types";
import { eventColor } from "../shared/lib/colors";

/** Цвет события: свой цвет события, иначе цвет календаря; переменная --c используется в CSS */
export const eventStyle = (calendar: Calendar | undefined, event?: Pick<CalendarEvent, "colorId">): CSSProperties =>
  ({ "--c": eventColor(event, calendar) }) as CSSProperties;
