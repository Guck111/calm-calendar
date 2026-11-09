import { useUnit } from "effector-react";
import { t } from "../shared/i18n";
import { useEffect, useRef, useState } from "react";
import { $accounts, $authError, $signingIn, signInClicked, signOutClicked } from "../model/auth";
import type { Calendar } from "../shared/api/types";
import { $calendarsWithVisibility, $writableCalendars, calendarToggled } from "../model/calendars";
import { createClicked, draftOpened } from "../model/editor";
import { quickCreateFx, quickFocusRequested } from "../model/quick";
import { QuickAdd, type QuickAddHandle } from "./QuickAdd";
import { $cursor, $range, $today, $view, dateSelected } from "../model/view";
import {
  formatDayNumber,
  addMonths,
  formatMonthYear,
  isSameDay,
  isSameMonth,
  monthGrid,
  startOfMonth,
  weekdayLabels,
} from "../shared/lib/date";
import { Button, cx } from "./Button";
import { ChevronLeft, ChevronRight, Plus } from "./icons";
import s from "./Sidebar.module.css";


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
          <Button variant="ghost" icon onClick={() => setMonth(addMonths(month, -1))} aria-label={t.common.prevMonth}>
            <ChevronLeft size={14} />
          </Button>
          <Button variant="ghost" icon onClick={() => setMonth(addMonths(month, 1))} aria-label={t.common.nextMonth}>
            <ChevronRight size={14} />
          </Button>
        </div>
      </div>
      <div className={s.miniGrid}>
        {weekdayLabels("narrow").map((d, i) => (
          <span key={i} className={s.miniWeekday}>
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
            {formatDayNumber(d)}
          </button>
        ))}
      </div>
    </section>
  );
};

const CalendarRow = ({ c, toggle }: { c: Calendar & { visible: boolean }; toggle: (id: string) => void }) => (
  <label className={s.calendar} title={c.name}>
    <input type="checkbox" checked={c.visible} onChange={() => toggle(c.id)} style={{ accentColor: c.color }} />
    <span className={s.swatch} style={{ background: c.visible ? c.color : "transparent", borderColor: c.color }} />
    <span className={s.name}>{c.name}</span>
  </label>
);

/** Календари по аккаунтам: у каждого аккаунта свой заголовок с email и «Выйти» */
const CalendarList = () => {
  const [calendars, accounts, toggle, signOut, signIn, signingIn] = useUnit([
    $calendarsWithVisibility,
    $accounts,
    calendarToggled,
    signOutClicked,
    signInClicked,
    $signingIn,
  ]);
  return (
    <section className={s.calendars}>
      <h3 className={s.heading}>{t.sidebar.calendars}</h3>
      {accounts.map((a) => (
        <div key={a.email} className={s.group} role="group" aria-label={a.email}>
          <div className={s.groupHead}>
            <span className={s.email} title={a.email}>
              {a.email}
            </span>
            <button
              type="button"
              className={s.signOut}
              onClick={() => signOut(a.email)}
              title={t.accounts.signOutTitle(a.email)}
            >
              {t.sidebar.signOut}
            </button>
          </div>
          {a.signedIn ? (
            calendars
              .filter((c) => c.account === a.email)
              .map((c) => <CalendarRow key={c.id} c={c} toggle={toggle} />)
          ) : (
            <p className={s.expired}>
              {t.accounts.expired}{" "}
              <button type="button" className={s.link} onClick={() => signIn()} disabled={signingIn}>
                {t.accounts.signInAgain}
              </button>
            </p>
          )}
        </div>
      ))}
    </section>
  );
};

const AddAccount = () => {
  const [signIn, signingIn, error] = useUnit([signInClicked, $signingIn, $authError]);
  return (
    <div className={s.account}>
      {error && <p className={s.error}>{error}</p>}
      <button type="button" className={s.add} onClick={() => signIn()} disabled={signingIn}>
        <Plus size={12} /> {signingIn ? t.auth.finishInBrowser : t.accounts.add}
      </button>
    </div>
  );
};

const SidebarQuickAdd = () => {
  const [writable, create, expand] = useUnit([$writableCalendars, quickCreateFx, draftOpened]);
  const ref = useRef<QuickAddHandle>(null);
  useEffect(() => quickFocusRequested.watch(() => ref.current?.focus()), []);
  return (
    <QuickAdd
      ref={ref}
      calendars={writable}
      onCreate={async (draft) => {
        await create(draft);
      }}
      onExpand={(draft) => expand(draft)}
    />
  );
};

export const Sidebar = () => {
  const create = useUnit(createClicked);
  return (
    <aside className={s.sidebar}>
      <Button variant="primary" className={s.create} onClick={() => create()} title={t.common.newEvent}>
        <Plus /> {t.sidebar.create}
      </Button>
      <SidebarQuickAdd />
      <MiniMonth />
      <CalendarList />
      <AddAccount />
    </aside>
  );
};
