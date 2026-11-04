import { useUnit } from "effector-react";
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
} from "../shared/lib/date";
import { overlapsDay } from "../shared/lib/layout";
import { cx } from "../ui/Button";
import {
  $data,
  $error,
  $loading,
  $now,
  $signedIn,
  $status,
  $today,
  authChanged,
  minuteTicked,
  refreshRequested,
  VISIBILITY_KEY,
  widgetStarted,
} from "./model";
import s from "./Widget.module.css";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MAX_EVENTS = 5;
const REFRESH_MS = 5 * 60_000;
const WIDTH = 300;

const pad = (n: number) => String(n).padStart(2, "0");

const whenLabel = (e: CalendarEvent, today: Date): string => {
  const day = e.start < today ? today : e.start;
  const dayLabel = isSameDay(day, today)
    ? "Сегодня"
    : isSameDay(day, addDays(today, 1))
      ? "Завтра"
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
  if (e.button !== 0 || !inTauri || (e.target as HTMLElement).closest("button")) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().startDragging();
};

export const Widget = () => {
  const cardRef = useRef<HTMLDivElement>(null);
  useWidgetEffects(cardRef);
  const refresh = useUnit(refreshRequested);
  const [status, signedIn, now, today, data, error, loading] = useUnit([
    $status,
    $signedIn,
    $now,
    $today,
    $data,
    $error,
    $loading,
  ]);

  const days = monthGrid(today);
  const eventDays = new Set(
    days.filter((d) => data.events.some((e) => overlapsDay(e, d))).map((d) => d.getTime()),
  );
  const upcoming = data.events
    .filter((e) => e.end > now)
    .sort((a, b) => a.start.getTime() - b.start.getTime() || Number(b.allDay) - Number(a.allDay))
    .slice(0, MAX_EVENTS);

  const color = (e: CalendarEvent) => ({ "--c": data.colors[e.calendarId] ?? "var(--accent)" }) as CSSProperties;

  return (
    <div className={s.card} ref={cardRef} onMouseDown={startDrag}>
      <button className={s.clock} onClick={() => openMain()} title="Открыть календарь">
        {pad(now.getHours())}:{pad(now.getMinutes())}
      </button>
      <div className={s.date}>
        {formatWeekdayLong(now)}, {formatDayMonth(now)}
      </div>

      <div className={s.month}>{formatMonthYear(today)}</div>
      <div className={s.grid}>
        {WEEKDAYS.map((d) => (
          <span key={d} className={s.weekday}>
            {d}
          </span>
        ))}
        {days.map((d) => (
          <button
            key={d.getTime()}
            className={cx(s.day, !isSameMonth(d, today) && s.outside, isSameDay(d, today) && s.today)}
            onClick={() => openMain(toDateKey(d))}
            title="Открыть день в календаре"
          >
            <span className={s.num}>{d.getDate()}</span>
            {eventDays.has(d.getTime()) && <i className={s.dot} />}
          </button>
        ))}
      </div>

      <div className={s.separator} />

      {!status ? null : !signedIn ? (
        <button className={s.note} onClick={() => openMain()}>
          Войди в Google в окне календаря
        </button>
      ) : error && !upcoming.length ? (
        <button className={s.note} onClick={() => refresh()}>
          Не удалось загрузить события. Повторить
        </button>
      ) : !upcoming.length ? (
        <div className={s.note}>{loading ? "Загружаю…" : "Ближайших событий нет"}</div>
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
    </div>
  );
};

