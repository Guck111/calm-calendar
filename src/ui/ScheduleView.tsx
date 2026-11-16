import { useUnit } from "effector-react";
import { useLayoutEffect, useRef } from "react";
import { t } from "../shared/i18n";
import { $calendarById } from "../model/calendars";
import { eventOpened } from "../model/editor";
import { $conflicts, $events } from "../model/events";
import { $cursor, $now, $today, $view, dayOpened } from "../model/view";
import { formatTime, formatWeekdayDayMonth, isSameDay, viewDays } from "../shared/lib/date";
import { eventsForDay, isAllDayLike } from "../shared/lib/layout";
import { cx } from "./Button";
import { eventStyle } from "./eventColor";
import { Repeat, Video, Warning } from "./icons";
import { isJoinable, shortPlace } from "../shared/lib/meeting";
import { openExternal } from "../shared/api/open";
import s from "./ScheduleView.module.css";

/** "Schedule": events of four weeks as a list by day, days without events are skipped */
export const ScheduleView = () => {
  const [view, cursor, today, now, events, calendars, conflicts] = useUnit([
    $view,
    $cursor,
    $today,
    $now,
    $events,
    $calendarById,
    $conflicts,
  ]);
  const [openEvent, openDay] = useUnit([eventOpened, dayOpened]);
  const days = viewDays(view, cursor)
    .map((day) => ({ day, list: eventsForDay(events, day) }))
    .filter((d) => d.list.length);
  const scrollRef = useRef<HTMLDivElement>(null);
  // each page starts from the top
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [cursor]);

  return (
    <div className={s.schedule} ref={scrollRef}>
      {!days.length && <p className={s.empty}>{t.schedule.empty}</p>}
      {days.map(({ day, list }) => (
        <section key={day.getTime()} className={cx(s.day, isSameDay(day, today) && s.today)}>
          <button className={s.date} onClick={() => openDay(day)} title={t.common.openDay}>
            {formatWeekdayDayMonth(day)}
          </button>
          <ul className={s.list}>
            {list.map((e) => {
              const clash = conflicts.get(e.key);
              const clashText = clash ? t.accounts.conflict(clash.map((c) => c.title).join(", ")) : "";
              const join = e.meeting && isJoinable(e.start, e.end, now) ? e.meeting : undefined;
              return (
                <li key={e.key} className={s.row}>
                  <button
                    className={cx(s.event, e.end <= now && s.past)}
                    style={eventStyle(calendars.get(e.calendarId), e)}
                    onClick={() => openEvent(e)}
                    data-event-key={e.key}
                  >
                    <span className={s.dot} />
                    <span className={s.time}>
                      {isAllDayLike(e) ? t.common.allDayLower : `${formatTime(e.start)}–${formatTime(e.end)}`}
                    </span>
                    <span className={s.title}>
                      {clash && (
                        <span className={s.clash} role="img" aria-label={clashText} title={clashText}>
                          <Warning size={11} />
                        </span>
                      )}
                      {e.recurring && <Repeat />}
                      {e.title}
                    </span>
                    {e.location && (
                      <span className={s.location} title={e.location}>
                        {shortPlace(e.location, e.meeting)}
                      </span>
                    )}
                  </button>
                  {/* like in the widget: from 15 minutes before the start until the end — straight into the call */}
                  {join && (
                    <button
                      className={s.join}
                      onClick={() => void openExternal(join.url)}
                      title={t.meeting.joinTitle(join.provider)}
                    >
                      <Video size={14} /> {t.meeting.join}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
};
