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
import { $weekNumbers } from "../model/display";
import { $lastSynced, syncedText } from "../model/sync";
import {
  formatDayNumber,
  formatWeekNumber,
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
  const [cursor, today, range, view, select, weekNumbers] = useUnit([
    $cursor,
    $today,
    $range,
    $view,
    dateSelected,
    $weekNumbers,
  ]);
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
      <div className={cx(s.miniGrid, weekNumbers && s.withWeeks)}>
        {weekNumbers && <span className={s.miniWeekday} />}
        {weekdayLabels("narrow").map((d, i) => (
          <span key={i} className={s.miniWeekday}>
            {d}
          </span>
        ))}
        {monthGrid(month).flatMap((d, i) => [
          ...(weekNumbers && i % 7 === 0
            ? [
                <span key={`w${d.getTime()}`} className={s.weekNo} title={t.time.week(formatWeekNumber(d))}>
                  {formatWeekNumber(d)}
                </span>,
              ]
            : []),
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
          </button>,
        ])}
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

/** «Выйти» спрашивает второй раз: выход сразу отзывает доступ, и войти заново — это снова окно Google.
 *  Вопрос пропадает, если увести с кнопки фокус или подождать */
const SignOutButton = ({ email, onConfirm }: { email: string; onConfirm: () => void }) => {
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!asking) return;
    const timer = window.setTimeout(() => setAsking(false), 5000);
    return () => window.clearTimeout(timer);
  }, [asking]);
  return (
    <button
      type="button"
      className={cx(s.signOut, asking && s.asking)}
      onClick={() => (asking ? onConfirm() : setAsking(true))}
      onBlur={() => setAsking(false)}
      onKeyDown={(e) => e.key === "Escape" && setAsking(false)}
      title={t.accounts.signOutTitle(email)}
    >
      {asking ? t.accounts.confirmSignOut : t.sidebar.signOut}
    </button>
  );
};

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
  const holidays = calendars.filter((c) => c.holiday);
  const feeds = calendars.filter((c) => c.feed);
  return (
    <section className={s.calendars}>
      <h3 className={s.heading}>{t.sidebar.calendars}</h3>
      {accounts.map((a) => (
        <div key={a.email} className={s.group} role="group" aria-label={a.email}>
          <div className={s.groupHead}>
            <span className={s.email} title={a.email}>
              {a.email}
            </span>
            <SignOutButton email={a.email} onConfirm={() => signOut(a.email)} />
          </div>
          {a.signedIn ? (
            calendars
              .filter((c) => c.account === a.email && !c.holiday)
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
      {holidays.length > 0 && (
        <div className={s.group} role="group" aria-label={t.sidebar.holidays}>
          <div className={s.groupHead}>
            <span className={s.email}>{t.sidebar.holidays}</span>
          </div>
          {holidays.map((c) => (
            <CalendarRow key={c.id} c={c} toggle={toggle} />
          ))}
        </div>
      )}
      {feeds.length > 0 && (
        <div className={s.group} role="group" aria-label={t.sidebar.feeds}>
          <div className={s.groupHead}>
            <span className={s.email}>{t.sidebar.feeds}</span>
          </div>
          {feeds.map((c) => (
            <CalendarRow key={c.id} c={c} toggle={toggle} />
          ))}
        </div>
      )}
    </section>
  );
};

const AddAccount = () => {
  const [signIn, signingIn, error, synced] = useUnit([signInClicked, $signingIn, $authError, $lastSynced]);
  return (
    <div className={s.account}>
      {synced !== null && <p className={s.synced}>{syncedText(synced)}</p>}
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
