import { useUnit } from "effector-react";
import { t } from "../shared/i18n";
import type { MouseEvent } from "react";
import { $calendarById } from "../model/calendars";
import { eventOpened, slotClicked } from "../model/editor";
import { $events } from "../model/events";
import { $cursor, $today, dayOpened } from "../model/view";
import { $weekNumbers } from "../model/display";
import type { CalendarEvent } from "../shared/api/types";
import {
  formatDayNumber,
  formatWeekNumber,
  formatMonthShort,
  formatTime,
  isSameDay,
  isSameMonth,
  monthGrid,
  startOfDay,
  weekdayLabels,
} from "../shared/lib/date";
import { eventsForDay, isAllDayLike } from "../shared/lib/layout";
import { cx } from "./Button";
import { eventStyle } from "./eventColor";
import s from "./MonthView.module.css";

const MAX_VISIBLE = 4;

export const MonthView = () => {
  const [cursor, today, events, calendars, weekNumbers] = useUnit([
    $cursor,
    $today,
    $events,
    $calendarById,
    $weekNumbers,
  ]);
  const [openEvent, openDay, createAt] = useUnit([eventOpened, dayOpened, slotClicked]);
  const days = monthGrid(cursor);

  const onCellClick = (day: Date) => (e: MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    const start = startOfDay(day);
    start.setHours(9);
    createAt({ start });
  };

  const chip = (event: CalendarEvent, day: Date) => {
    const block = isAllDayLike(event);
    const continues = block && !isSameDay(event.start, day) && day.getDay() !== 1;
    return (
      <button
        key={event.key}
        className={cx(s.event, block && s.block, continues && s.continues)}
        style={eventStyle(calendars.get(event.calendarId), event)}
        onClick={() => openEvent(event)}
        title={event.title}
        data-event-key={event.key}
      >
        {!block && <span className={s.dot} />}
        {!block && <span className={s.time}>{formatTime(event.start)}</span>}
        <span className={s.label}>{event.title}</span>
      </button>
    );
  };

  return (
    <div className={s.month}>
      <div className={s.weekdays}>
        {weekdayLabels().map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className={s.grid}>
        {days.map((day, i) => {
          const list = eventsForDay(events, day);
          const hidden = list.length - MAX_VISIBLE;
          const visible = hidden > 0 ? list.slice(0, MAX_VISIBLE - 1) : list;
          return (
            <div
              key={day.getTime()}
              className={cx(s.cell, !isSameMonth(day, cursor) && s.outside)}
              onClick={onCellClick(day)}
            >
              {weekNumbers && i % 7 === 0 && (
                <span className={s.weekNo} title={t.time.week(formatWeekNumber(day))}>
                  {formatWeekNumber(day)}
                </span>
              )}
              <button
                className={cx(s.dayNumber, isSameDay(day, today) && s.today)}
                onClick={() => openDay(day)}
                title={t.common.openDay}
              >
                {day.getDate() === 1 ? `${formatDayNumber(day)} ${formatMonthShort(day)}` : formatDayNumber(day)}
              </button>
              {visible.map((e) => chip(e, day))}
              {hidden > 0 && (
                <button className={s.more} onClick={() => openDay(day)}>
                  {t.month.more(hidden + 1)}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
