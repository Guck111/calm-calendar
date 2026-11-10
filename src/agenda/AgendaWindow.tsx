// Список дел на сегодня и завтра: открывается левым кликом по значку в трее
// (в Windows 11 из часов на панели задач убрали события). Данные — та же модель, что у виджета.
import { useUnit } from "effector-react";
import { useEffect, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { inTauri, openMain, subscribe } from "../shared/api/bus";
import { openExternal } from "../shared/api/open";
import type { CalendarEvent } from "../shared/api/types";
import { t } from "../shared/i18n";
import { formatTime, formatWeekdayDayMonth, toDateKey } from "../shared/lib/date";
import { isJoinable } from "../shared/lib/meeting";
import { cx } from "../ui/Button";
import { Video } from "../ui/icons";
import { EVENT_COLORS } from "../shared/lib/colors";
import { $colors, $loading, $now, $signedIn, $status, $upcoming, minuteTicked, refreshRequested, widgetStarted } from "../widget/model";
import { agendaDays, isNow, isPast } from "./agenda";
import s from "./Agenda.module.css";

const hide = () => {
  if (inTauri) void invoke("hide_agenda");
};

const open = (date?: string) => {
  openMain(date);
  hide();
};

const when = (e: CalendarEvent, day: Date): string => {
  if (e.allDay || (e.start <= day && e.end.getTime() - day.getTime() >= 86_400_000)) return t.common.allDay;
  return `${formatTime(e.start)}–${formatTime(e.end)}`;
};

export const AgendaWindow = () => {
  const [start, tick, refresh] = useUnit([widgetStarted, minuteTicked, refreshRequested]);
  const [status, signedIn, now, events, colors, loading] = useUnit([$status, $signedIn, $now, $upcoming, $colors, $loading]);

  useEffect(() => {
    start();
    // при каждом показе — свежие данные и текущее время
    const offShown = subscribe("agenda-shown", () => {
      tick(new Date());
      refresh();
    });
    const offEvents = subscribe("events-changed", () => refresh());
    const timer = window.setInterval(() => tick(new Date()), 30_000);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    window.addEventListener("keydown", onKey);
    return () => {
      offShown();
      offEvents();
      window.clearInterval(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [start, tick, refresh]);

  const color = (e: CalendarEvent) =>
    ({ "--c": (e.colorId && EVENT_COLORS[e.colorId]) || colors[e.calendarId] || "var(--accent)" }) as CSSProperties;
  const days = agendaDays(events, now);

  return (
    <div className={s.panel}>
      <div className={s.scroll}>
        {!status ? null : !signedIn ? (
          <p className={s.note}>{t.widget.signInHint}</p>
        ) : (
          days.map(({ day, events: list }, i) => (
            <section key={day.getTime()} className={s.day}>
              <h2 className={s.dayTitle}>
                {i === 0 ? t.common.today : t.common.tomorrow}
                <span className={s.date}>{formatWeekdayDayMonth(day)}</span>
              </h2>
              {!list.length ? (
                <p className={s.note}>{loading ? t.common.loading : t.agenda.empty}</p>
              ) : (
                <ul className={s.events}>
                  {list.map((e) => {
                    const join = e.meeting && isJoinable(e.start, e.end, now) ? e.meeting : undefined;
                    return (
                      <li key={e.key} className={cx(s.row, isPast(e, now) && s.past, isNow(e, now) && s.now)} style={color(e)}>
                        <button className={s.event} onClick={() => open(toDateKey(day))}>
                          <span className={s.when}>{when(e, day)}</span>
                          <span className={s.title}>{e.title}</span>
                        </button>
                        {join && (
                          <button className={s.join} onClick={() => void openExternal(join.url)} title={t.meeting.joinTitle(join.provider)}>
                            <Video size={13} /> {t.meeting.join}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ))
        )}
      </div>
      <button className={s.footer} onClick={() => open()}>
        {t.common.openCalendar}
      </button>
    </div>
  );
};
