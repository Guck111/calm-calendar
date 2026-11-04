import { useUnit } from "effector-react";
import { useEffect, useState } from "react";
import { $email, signOutClicked } from "../model/auth";
import { $calendarsWithVisibility, calendarToggled } from "../model/calendars";
import { createClicked } from "../model/editor";
import { $cursor, $range, $today, $view, dateSelected } from "../model/view";
import {
  addMonths,
  formatMonthYear,
  isSameDay,
  isSameMonth,
  monthGrid,
  startOfMonth,
} from "../shared/lib/date";
import { Button, cx } from "./Button";
import { ChevronLeft, ChevronRight, Plus } from "./icons";
import s from "./Sidebar.module.css";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const MiniMonth = () => {
  const [cursor, today, range, view, select] = useUnit([$cursor, $today, $range, $view, dateSelected]);
  // мини-календарь листается сам, но догоняет основной вид при его смене
  const [month, setMonth] = useState(() => startOfMonth(cursor));
  useEffect(() => setMonth(startOfMonth(cursor)), [cursor]);

  return (
    <section className={s.mini}>
      <div className={s.miniHead}>
        <span>{formatMonthYear(month)}</span>
        <div>
          <Button variant="ghost" icon onClick={() => setMonth(addMonths(month, -1))} aria-label="Предыдущий месяц">
            <ChevronLeft size={14} />
          </Button>
          <Button variant="ghost" icon onClick={() => setMonth(addMonths(month, 1))} aria-label="Следующий месяц">
            <ChevronRight size={14} />
          </Button>
        </div>
      </div>
      <div className={s.miniGrid}>
        {WEEKDAYS.map((d) => (
          <span key={d} className={s.miniWeekday}>
            {d}
          </span>
        ))}
        {monthGrid(month).map((d) => (
          <button
            key={d.getTime()}
            className={cx(
              s.miniDay,
              !isSameMonth(d, month) && s.outside,
              view !== "month" && d >= range.start && d < range.end && s.inRange,
              isSameDay(d, today) && s.today,
            )}
            onClick={() => select(d)}
          >
            {d.getDate()}
          </button>
        ))}
      </div>
    </section>
  );
};

const CalendarList = () => {
  const [calendars, toggle] = useUnit([$calendarsWithVisibility, calendarToggled]);
  if (!calendars.length) return null;
  return (
    <section className={s.calendars}>
      <h3 className={s.heading}>Календари</h3>
      {calendars.map((c) => (
        <label key={c.id} className={s.calendar} title={c.name}>
          <input
            type="checkbox"
            checked={c.visible}
            onChange={() => toggle(c.id)}
            style={{ accentColor: c.color }}
          />
          <span className={s.swatch} style={{ background: c.visible ? c.color : "transparent", borderColor: c.color }} />
          <span className={s.name}>{c.name}</span>
        </label>
      ))}
    </section>
  );
};

export const Sidebar = () => {
  const [email, create, signOut] = useUnit([$email, createClicked, signOutClicked]);
  return (
    <aside className={s.sidebar}>
      <Button variant="primary" className={s.create} onClick={() => create()} title="Новое событие (N)">
        <Plus /> Создать
      </Button>
      <MiniMonth />
      <CalendarList />
      <div className={s.account}>
        {email && <span className={s.email}>{email}</span>}
        <button type="button" className={s.signOut} onClick={() => signOut()}>
          Выйти
        </button>
      </div>
    </aside>
  );
};
