import type { CSSProperties } from "react";
import type { Calendar } from "../shared/api/types";

const FALLBACK = "#8ab4f8";

/** Цвет события берём из цвета календаря; переменная --c используется в CSS */
export const eventStyle = (calendar: Calendar | undefined): CSSProperties =>
  ({ "--c": calendar?.color ?? FALLBACK }) as CSSProperties;
