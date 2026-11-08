import { useUnit } from "effector-react";
import { t } from "../shared/i18n";
import { useEffect, useLayoutEffect, useRef, type CSSProperties, type MouseEvent, type RefObject } from "react";
import { openMain, subscribe, inTauri } from "../shared/api/bus";
import type { CalendarEvent } from "../shared/api/types";
import {
  addDays,
  formatDayMonth,
  formatMonthYear,
  formatTime,
  formatWeekdayLong,
  formatWeekdayShort,
  isSameDay,
  isSameMonth,
  monthGrid,
  toDateKey,
  weekdayLabels,
} from "../shared/lib/date";
import { overlapsDay } from "../shared/lib/layout";
import { cx } from "../ui/Button";
import { ChevronLeft, ChevronRight } from "../ui/icons";
import { QuickAdd } from "../ui/QuickAdd";
import { broadcast } from "../shared/api/bus";
import { saveEvent } from "../shared/api/calendar";
import { countdown } from "./countdown";
import {
  $calendars,
  $colors,
  $error,
  $isCurrentMonth,
  $loading,
  $month,
  $monthEvents,
  $now,
  $signedIn,
  $status,
  $today,
  $upcoming,
  authChanged,
  minuteTicked,
  monthReset,
  monthShifted,
  refreshRequested,
  VISIBILITY_KEY,
  widgetStarted,
} from "./model";
import s from "./Widget.module.css";

const MAX_EVENTS = 5;
const REFRESH_MS = 5 * 60_000;
const WIDTH = 300;

const whenLabel = (e: CalendarEvent, today: Date): string => {
  const day = e.start < today ? today : e.start;
  const dayLabel = isSameDay(day, today)
    ? t.common.today
    : isSameDay(day, addDays(today, 1))
      ? t.common.tomorrow
      : `${formatWeekdayShort(day)}, ${day.getDate()}`;
  return e.allDay || e.start < today ? dayLabel : `${dayLabel} ${formatTime(e.start)}`;
};

/** таймеры, обновление по событиям других окон и подгонка высоты окна под содержимое */
const useWidgetEffects = (cardRef: RefObject<HTMLDivElement | null>) => {
  const [start, tick, refresh, onAuth] = useUnit([widgetStarted, minuteTicked, refreshRequested, authChanged]);

  useEffect(() => {
    start();
    const offEvents = subscribe("events-changed", () => refresh());
    const offAuth = subscribe("auth-changed", () => onAuth());
    const onStorage = (e: StorageEvent) => e.key === VISIBILITY_KEY && refresh();
    window.addEventListener("storage", onStorage);
    const interval = window.setInterval(() => refresh(), REFRESH_MS);
    return () => {
      offEvents();
      offAuth();
      window.removeEventListener("storage", onStorage);
      window.clearInterval(interval);
    };
  }, [start, refresh, onAuth]);

  useEffect(() => {
    let interval: number | undefined;
    const timeout = window.setTimeout(() => {
      tick(new Date());
      interval = window.setInterval(() => tick(new Date()), 60_000);
    }, 60_000 - (Date.now() % 60_000) + 50);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [tick]);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card || !inTauri) return;
    let cancelled = false;
    const resize = async () => {
      const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
      if (!cancelled) await getCurrentWindow().setSize(new LogicalSize(WIDTH, Math.ceil(card.offsetHeight)));
    };
    const observer = new ResizeObserver(() => void resize());
    observer.observe(card);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [cardRef]);
};

/** перетаскивание окна за любое место карточки, кроме кнопок */
const startDrag = async (e: MouseEvent) => {
  if (e.button !== 0 || !inTauri || (e.target as HTMLElement).closest("button, input")) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().startDragging();
};

export const Widget = () => {
  const cardRef = useRef<HTMLDivElement>(null);
  useWidgetEffects(cardRef);
  const [refresh, shift, reset] = useUnit([refreshRequested, monthShifted, monthReset]);
  const [status, signedIn, now, today, month, isCurrent, monthEvents, allUpcoming, colors, error, loading, calendars] = useUnit([
    $status,
    $signedIn,
    $now,
    $today,
    $month,
    $isCurrentMonth,
    $monthEvents,
    $upcoming,
    $colors,
    $error,
    $loading,
    $calendars,
  ]);
  const writable = calendars.filter((c) => c.accessRole === "owner" || c.accessRole === "writer");
  const soon = countdown(allUpcoming, now);

  const days = monthGrid(month);
  const eventDays = new Set(
    days.filter((d) => monthEvents.some((e) => overlapsDay(e, d))).map((d) => d.getTime()),
  );
  const upcoming = allUpcoming
    .filter((e) => e.end > now)
    .sort((a, b) => a.start.getTime() - b.start.getTime() || Number(b.allDay) - Number(a.allDay))
    .slice(0, MAX_EVENTS);

  const color = (e: CalendarEvent) => ({ "--c": colors[e.calendarId] ?? "var(--accent)" }) as CSSProperties;

  return (
    <div className={s.card} ref={cardRef} onMouseDown={startDrag}>
      <button className={s.clock} onClick={() => openMain()} title={t.common.openCalendar}>
        {formatTime(now)}
      </button>
      <div className={s.date}>
        {formatWeekdayLong(now)}, {formatDayMonth(now)}
      </div>
      {soon && (
        <div className={s.countdown}>
          <b>{soon.title}</b> <span className={s.countdownText}>{soon.text}</span>
        </div>
      )}

      <div className={s.monthBar}>
        <button
          className={cx(s.month, !isCurrent && s.monthOther)}
          onClick={() => reset()}
          title={isCurrent ? undefined : t.widget.backToCurrentMonth}
          disabled={isCurrent}
        >
          {formatMonthYear(month)}
        </button>
        <button className={s.arrow} onClick={() => shift(-1)} aria-label={t.common.prevMonth}>
          <ChevronLeft size={14} />
        </button>
        <button className={s.arrow} onClick={() => shift(1)} aria-label={t.common.nextMonth}>
          <ChevronRight size={14} />
        </button>
      </div>
      <div className={s.grid}>
        {weekdayLabels("narrow").map((d, i) => (
          <span key={i} className={s.weekday}>
            {d}
          </span>
        ))}
        {days.map((d) => (
          <button
            key={d.getTime()}
            className={cx(s.day, !isSameMonth(d, month) && s.outside, isSameDay(d, today) && s.today)}
            onClick={() => openMain(toDateKey(d))}
            title={t.widget.openDay}
          >
            <span className={s.num}>{d.getDate()}</span>
            {eventDays.has(d.getTime()) && <i className={s.dot} />}
          </button>
        ))}
      </div>

      <div className={s.separator} />

      {!status ? null : !signedIn ? (
        <button className={s.note} onClick={() => openMain()}>
          {t.widget.signInHint}
        </button>
      ) : error && !upcoming.length ? (
        <button className={s.note} onClick={() => refresh()}>
          {t.widget.loadFailed}
        </button>
      ) : !upcoming.length ? (
        <div className={s.note}>{loading ? t.common.loading : t.widget.noUpcoming}</div>
      ) : (
        <ul className={s.events}>
          {upcoming.map((e) => (
            <li key={e.key}>
              <button className={s.event} style={color(e)} onClick={() => openMain(toDateKey(e.start < today ? today : e.start))}>
                <span className={s.when}>{whenLabel(e, today)}</span>
                <span className={s.title}>{e.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {signedIn && (
        <div className={s.quick}>
          <QuickAdd
            variant="widget"
            calendars={writable}
            onCreate={async (draft) => {
              await saveEvent(draft);
              refresh();
              broadcast("events-changed", { from: "widget" });
            }}
            onExpand={(draft) => {
              openMain(draft.startDate);
              broadcast("open-draft", draft);
            }}
          />
        </div>
      )}
    </div>
  );
};

