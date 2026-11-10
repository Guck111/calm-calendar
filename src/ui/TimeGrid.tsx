import { useUnit } from "effector-react";
import { isRtl, t } from "../shared/i18n";
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { $calendarById, $writableCalendars } from "../model/calendars";
import type { CalendarEvent } from "../shared/api/types";
import { shiftEvent, snap, type DragMode } from "../shared/lib/drag";
import { eventMoved, eventOpened, slotClicked } from "../model/editor";
import { $conflicts, $events } from "../model/events";
import { $cursor, $now, $today, $view, dayOpened } from "../model/view";
import {
  formatDayNumber,
  formatHour,
  formatSpan as travelSpan,
  formatTime,
  formatWeekdayShort,
  isSameDay,
  localTimeZone,
  MINUTES_IN_DAY,
  minutesOfDay,
  startOfDay,
  viewDays,
} from "../shared/lib/date";
import { eventsForDay, isAllDayLike, layoutDay } from "../shared/lib/layout";
import { zoneHours, zoneLabel, zoneShort } from "../shared/lib/tz";
import { $secondZone } from "../model/zones";
import { cx } from "./Button";
import { eventStyle } from "./eventColor";
import { Repeat, Warning } from "./icons";
import s from "./TimeGrid.module.css";

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const SNAP_MINUTES = 30;
/** ширина колонки с часами */
const GUTTER = 56;

/** короткое название пояса над колонкой его часов, полное — в подсказке */
const ZoneHead = ({ zone, at }: { zone: string; at: Date }) => (
  <div className={s.zoneHead} title={zoneLabel(zone, at)}>
    {zoneShort(zone, at)}
  </div>
);

/** сдвиг мыши, после которого клик считается перетаскиванием */
const DRAG_THRESHOLD = 4;

type Drag = {
  event: CalendarEvent;
  mode: DragMode;
  x0: number;
  y0: number;
  minutes: number;
  days: number;
  moved: boolean;
};

export const TimeGrid = () => {
  const [view, cursor, today, now, events, calendars, conflicts] = useUnit([
    $view,
    $cursor,
    $today,
    $now,
    $events,
    $calendarById,
    $conflicts,
  ]);
  const [openEvent, createAt, openDay, move, writable] = useUnit([
    eventOpened,
    slotClicked,
    dayOpened,
    eventMoved,
    $writableCalendars,
  ]);
  const days = viewDays(view, cursor);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const editable = new Set(writable.map((c) => c.id));
  const secondZone = useUnit($secondZone);
  const gutters = secondZone ? 2 : 1;

  // пока тянем, показываем событие на новом месте
  const shown = drag?.moved
    ? events.map((e) =>
        e.key === drag.event.key ? { ...e, ...shiftEvent(drag.event, drag.mode, drag.minutes, drag.days) } : e,
      )
    : events;

  const startDrag = (event: CalendarEvent, mode: DragMode) => (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || !editable.has(event.calendarId)) return;
    e.stopPropagation();
    e.preventDefault();
    setDrag({ event, mode, x0: e.clientX, y0: e.clientY, minutes: 0, days: 0, moved: false });
  };

  // слушаем всё окно: при переносе в другой день блок события пересоздаётся в другой колонке
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: globalThis.PointerEvent) => {
      const d = dragRef.current;
      if (!d || !bodyRef.current) return;
      const rect = bodyRef.current.getBoundingClientRect();
      const dx = e.clientX - d.x0;
      const dy = e.clientY - d.y0;
      const moved = d.moved || Math.hypot(dx, dy) > DRAG_THRESHOLD;
      const columnWidth = (rect.width - GUTTER * gutters) / days.length;
      const minutes = snap((dy / rect.height) * MINUTES_IN_DAY);
      // справа налево дни идут в другую сторону
      const dayShift = d.mode === "move" ? Math.round((isRtl() ? -dx : dx) / columnWidth) : 0;
      if (moved !== d.moved || minutes !== d.minutes || dayShift !== d.days) {
        setDrag({ ...d, moved, minutes, days: dayShift });
      }
    };
    const onUp = () => {
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;
      if (!d.moved) {
        openEvent(d.event);
        return;
      }
      if (d.minutes === 0 && d.days === 0) return;
      move({ event: d.event, ...shiftEvent(d.event, d.mode, d.minutes, d.days) });
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrag(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, [dragging, days.length, gutters, move, openEvent]);

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

  const allDayRows = days.map((d) => eventsForDay(shown, d).filter(isAllDayLike));
  const hasAllDay = allDayRows.some((r) => r.length);
  const columns = { gridTemplateColumns: `repeat(${gutters}, ${GUTTER}px) repeat(${days.length}, minmax(0, 1fr))` };
  // смещение второго пояса берём на сегодня, если он на экране, иначе на первый день
  const refDay = days.find((d) => isSameDay(d, today)) ?? days[0];
  const systemZone = localTimeZone();

  return (
    <div className={cx(s.wrap, view === "day" && s.single)}>
      <div className={s.head} style={columns}>
        {secondZone ? (
          <>
            <ZoneHead zone={secondZone} at={refDay} />
            <ZoneHead zone={systemZone} at={refDay} />
          </>
        ) : (
          <div />
        )}
        {days.map((d) => (
          <button
            key={d.getTime()}
            className={cx(s.dayHead, isSameDay(d, today) && s.today)}
            onClick={() => openDay(d)}
            disabled={view === "day"}
          >
            <span className={s.weekday}>{formatWeekdayShort(d)}</span>
            <span className={s.date}>{formatDayNumber(d)}</span>
          </button>
        ))}
      </div>

      {hasAllDay && (
        <div className={s.allDay} style={columns}>
          <div className={s.allDayLabel} style={{ gridColumn: `span ${gutters}` }}>
            {t.common.allDayLower}
          </div>
          {allDayRows.map((list, i) => (
            <div key={days[i].getTime()} className={s.allDayCell}>
              {list.map((e) => (
                <button
                  key={e.key}
                  className={s.allDayEvent}
                  style={eventStyle(calendars.get(e.calendarId), e)}
                  onClick={() => openEvent(e)}
                  title={e.title}
                  data-event-key={e.key}
                >
                  {e.title}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className={s.scroll} ref={scrollRef}>
        <div className={cx(s.body, drag?.moved && s.dragging)} style={columns} ref={bodyRef}>
          {secondZone && (
            <div className={cx(s.hours, s.secondHours)} aria-label={zoneLabel(secondZone, refDay)}>
              {zoneHours(refDay, secondZone).map(({ hour, minute }, h) => (
                <span key={h} className={s.hour}>
                  {h > 0 && (minute === 0 ? formatHour(hour) : formatTime(new Date(2000, 0, 1, hour, minute)))}
                </span>
              ))}
            </div>
          )}
          <div className={s.hours}>
            {HOURS.map((h) => (
              <span key={h} className={s.hour}>
                {h > 0 && formatHour(h)}
              </span>
            ))}
          </div>
          {days.map((day) => {
            const isToday = isSameDay(day, today);
            return (
              <div key={day.getTime()} className={cx(s.column, isToday && s.todayColumn)} onClick={onColumnClick(day)}>
                {layoutDay(shown, day).map(({ event, startMin, endMin, column, columns: count }) => {
                  const short = endMin - startMin < 45;
                  const canDrag = editable.has(event.calendarId);
                  const isDragged = drag?.moved && drag.event.key === event.key;
                  const clash = conflicts.get(event.key);
                  const clashText = clash ? t.accounts.conflict(clash.map((c) => c.title).join(", ")) : "";
                  const left = `calc(${(column / count) * 100}% + 1px)`;
                  const width = `calc(${100 / count}% - 3px)`;
                  // дорога до события: заштрихованная полоса над ним, в пределах этого дня
                  const travelStart = event.travelMinutes && !isAllDayLike(event) ? Math.max(0, startMin - event.travelMinutes) : startMin;
                  const travelText = event.travelMinutes ? t.editor.travelLine(travelSpan(event.travelMinutes)) : "";
                  return [
                    travelStart < startMin && (
                      <div
                        key={`${event.key}-travel`}
                        className={s.travel}
                        style={{
                          ...eventStyle(calendars.get(event.calendarId), event),
                          top: `${(travelStart / MINUTES_IN_DAY) * 100}%`,
                          height: `${((startMin - travelStart) / MINUTES_IN_DAY) * 100}%`,
                          insetInlineStart: left,
                          width,
                        }}
                        title={travelText}
                      >
                        {startMin - travelStart >= 20 && <span>{t.editor.onTheWay}</span>}
                      </div>
                    ),
                    <button
                      key={event.key}
                      className={cx(
                        s.event,
                        short && s.short,
                        canDrag && s.draggable,
                        isDragged && s.dragged,
                        clash && s.conflict,
                      )}
                      style={{
                        ...eventStyle(calendars.get(event.calendarId), event),
                        top: `${(startMin / MINUTES_IN_DAY) * 100}%`,
                        height: `${((endMin - startMin) / MINUTES_IN_DAY) * 100}%`,
                        insetInlineStart: left,
                        width,
                      }}
                      onPointerDown={startDrag(event, "move")}
                      // клик мышью по своему событию обрабатывает перетаскивание; здесь — клавиатура и чужие календари
                      onClick={(e) => (e.detail === 0 || !canDrag) && openEvent(event)}
                      data-event-key={event.key}
                      title={`${formatTime(event.start)}–${formatTime(event.end)} ${event.title}${clash ? `\n${clashText}` : ""}`}
                    >
                      <span className={s.eventTitle}>
                        {clash && (
                          <span className={s.clash} role="img" aria-label={clashText}>
                            <Warning size={11} />
                          </span>
                        )}
                        {event.recurring && <Repeat />}
                        {event.title}
                      </span>
                      <span className={s.eventTime}>
                        {formatTime(event.start)}–{formatTime(event.end)}
                      </span>
                      {canDrag && (
                        <span
                          className={s.resize}
                          onPointerDown={startDrag(event, "resize")}
                          aria-hidden
                        />
                      )}
                    </button>,
                  ];
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
