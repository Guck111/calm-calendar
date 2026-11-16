import type { CSSProperties } from "react";
import type { Calendar, CalendarEvent } from "../shared/api/types";
import { eventColor } from "../shared/lib/colors";

/** Event color: the event's own color, otherwise the calendar color; the --c variable is used in CSS */
export const eventStyle = (calendar: Calendar | undefined, event?: Pick<CalendarEvent, "colorId">): CSSProperties =>
  ({ "--c": eventColor(event, calendar) }) as CSSProperties;
