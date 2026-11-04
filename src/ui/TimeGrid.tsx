import { useUnit } from "effector-react";
import { useLayoutEffect, useRef, type MouseEvent } from "react";
import { $calendarById } from "../model/calendars";
import { eventOpened, slotClicked } from "../model/editor";
import { $events } from "../model/events";
import { $cursor, $now, $today, $view, dayOpened } from "../model/view";
import {
  formatTime,
  formatWeekdayShort,
  isSameDay,
  MINUTES_IN_DAY,
  minutesOfDay,
  startOfDay,
  viewDays,
} from "../shared/lib/date";
import { eventsForDay, isAllDayLike, layoutDay } from "../shared/lib/layout";
import { cx } from "./Button";
import { eventStyle } from "./eventColor";
import { Repeat } from "./icons";
import s from "./TimeGrid.module.css";

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const SNAP_MINUTES = 30;

const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

export const TimeGrid = () => {
  const [view, cursor, today, now, events, calendars] = useUnit([
    $view,
    $cursor,
    $today,
    $now,
    $events,
    $calendarById,
  ]);
  const [openEvent, createAt, openDay] = useUnit([eventOpened, slotClicked, dayOpened]);
  const days = viewDays(view, cursor);
  const scrollRef = useRef<HTMLDivElement>(null);

  // при открытии прокручиваем к 7 утра, а если на экране сегодня и уже вечер — ближе к текущему часу
  const showsToday = days.some((d) => isSameDay(d, today));
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const hour = parseFloat(getComputedStyle(el).getPropertyValue("--hour")) || 52;
    const target = showsToday ? Math.min(Math.max(7, new Date().getHours() - 2), 16) : 7;
    el.scrollTop = hour * target - 8;
  }, [view, showsToday]);

  const onColumnClick = (day: Date) => (e: MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const minutes = ((e.clientY - rect.top) / rect.height) * MINUTES_IN_DAY;
    const snapped = Math.floor(minutes / SNAP_MINUTES) * SNAP_MINUTES;
    const start = startOfDay(day);
    start.setMinutes(Math.min(snapped, MINUTES_IN_DAY - SNAP_MINUTES));
    createAt({ start });
  };

  const allDayRows = days.map((d) => eventsForDay(events, d).filter(isAllDayLike));
  const hasAllDay = allDayRows.some((r) => r.length);
  const columns = { gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` };

  return (
    <div className={cx(s.wrap, view === "day" && s.single)}>
      <div className={s.head} style={columns}>
        <div />
        {days.map((d) => (
          <button
            key={d.getTime()}
            className={cx(s.dayHead, isSameDay(d, today) && s.today)}
            onClick={() => openDay(d)}
            disabled={view === "day"}
          >
            <span className={s.weekday}>{formatWeekdayShort(d)}</span>
            <span className={s.date}>{d.getDate()}</span>
          </button>
        ))}
      </div>

      {hasAllDay && (
        <div className={s.allDay} style={columns}>
          <div className={s.allDayLabel}>весь день</div>
          {allDayRows.map((list, i) => (
            <div key={days[i].getTime()} className={s.allDayCell}>
              {list.map((e) => (
                <button
                  key={e.key}
                  className={s.allDayEvent}
                  style={eventStyle(calendars.get(e.calendarId))}
                  onClick={() => openEvent(e)}
                  title={e.title}
                >
                  {e.title}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className={s.scroll} ref={scrollRef}>
        <div className={s.body} style={columns}>
          <div className={s.hours}>
            {HOURS.map((h) => (
              <span key={h} className={s.hour}>
                {h > 0 && hourLabel(h)}
              </span>
            ))}
          </div>
          {days.map((day) => {
            const isToday = isSameDay(day, today);
            return (
              <div key={day.getTime()} className={s.column} onClick={onColumnClick(day)}>
                {layoutDay(events, day).map(({ event, startMin, endMin, column, columns: count }) => {
                  const short = endMin - startMin < 45;
                  return (
                    <button
                      key={event.key}
                      className={cx(s.event, short && s.short)}
                      style={{
                        ...eventStyle(calendars.get(event.calendarId)),
                        top: `${(startMin / MINUTES_IN_DAY) * 100}%`,
                        height: `${((endMin - startMin) / MINUTES_IN_DAY) * 100}%`,
                        left: `calc(${(column / count) * 100}% + 1px)`,
                        width: `calc(${100 / count}% - 3px)`,
                      }}
                      onClick={() => openEvent(event)}
                      title={`${formatTime(event.start)}–${formatTime(event.end)} ${event.title}`}
                    >
                      <span className={s.eventTitle}>
                        {event.recurring && <Repeat />}
                        {event.title}
                      </span>
                      <span className={s.eventTime}>
                        {formatTime(event.start)}–{formatTime(event.end)}
                      </span>
                    </button>
                  );
                })}
                {isToday && (
                  <div className={s.now} style={{ top: `${(minutesOfDay(now) / MINUTES_IN_DAY) * 100}%` }} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
