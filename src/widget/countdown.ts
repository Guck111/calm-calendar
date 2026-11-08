import type { CalendarEvent } from "../shared/api/types";
import { t } from "../shared/i18n";

const LOOK_AHEAD_MS = 12 * 60 * 60_000;

const span = (ms: number): string => {
  const total = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return t.time.span(h, m);
};

/** «Muay Thai через 25 мин» или «Сейчас: Работа · ещё 2 ч 10 мин»; события на весь день не считаем */
export const countdown = (events: CalendarEvent[], now: Date): { title: string; text: string } | null => {
  const timed = events
    .filter((e) => !e.allDay && e.end > now)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const current = timed.find((e) => e.start <= now);
  const next = timed.find((e) => e.start > now);
  // если следующее начинается скоро (до 30 минут), важнее оно, а не текущее
  if (next && next.start.getTime() - now.getTime() <= 30 * 60_000) {
    return { title: next.title, text: t.time.in(span(next.start.getTime() - now.getTime())) };
  }
  if (current) return { title: current.title, text: t.time.ongoing(span(current.end.getTime() - now.getTime())) };
  if (next && next.start.getTime() - now.getTime() <= LOOK_AHEAD_MS) {
    return { title: next.title, text: t.time.in(span(next.start.getTime() - now.getTime())) };
  }
  return null;
};
