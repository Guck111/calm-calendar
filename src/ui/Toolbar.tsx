import { useUnit } from "effector-react";
import { t } from "../shared/i18n";
import { $loading, refreshRequested } from "../model/events";
import { $cursor, $view, nextClicked, prevClicked, todayClicked, viewChanged } from "../model/view";
import { formatWeekNumber, startOfWeek, viewTitle, type ViewMode } from "../shared/lib/date";
import { $weekNumbers } from "../model/display";
import { createClicked } from "../model/editor";
import { $sidebar, sidebarToggled } from "../model/sidebar";
import { Button, cx } from "./Button";
import { Search } from "./Search";
import { FreeSlotsButton } from "./FreeSlots";
import { SettingsButton } from "./SettingsButton";
import { ViewMenu } from "./ViewMenu";
import { ChevronLeft, ChevronRight, Panel, Plus, Refresh } from "./icons";
import s from "./Toolbar.module.css";

const VIEWS: { id: ViewMode; key: string }[] = [
  { id: "day", key: "D" },
  { id: "week", key: "W" },
  { id: "month", key: "M" },
  { id: "agenda", key: "A" },
];

export const Toolbar = () => {
  const [view, cursor, loading, weekNumbers, sidebar] = useUnit([$view, $cursor, $loading, $weekNumbers, $sidebar]);
  const [onSidebar, onCreate] = useUnit([sidebarToggled, createClicked]);
  // in the "Week" and "Day" views the week number is in the title
  const week =
    weekNumbers && (view === "week" || view === "day") ? t.time.week(formatWeekNumber(startOfWeek(cursor))) : null;
  const [onPrev, onNext, onToday, onView, onRefresh] = useUnit([
    prevClicked,
    nextClicked,
    todayClicked,
    viewChanged,
    refreshRequested,
  ]);

  return (
    <header className={s.bar}>
      <Button
        variant="ghost"
        icon
        onClick={() => onSidebar()}
        title={t.toolbar.sidebar}
        aria-label={t.toolbar.sidebar}
        aria-expanded={sidebar.shown}
        aria-controls="sidebar"
      >
        <Panel />
      </Button>
      {/* the Create button is in the side panel: without the panel it moves here */}
      {!sidebar.shown && (
        <Button variant="ghost" icon onClick={() => onCreate()} title={t.common.newEvent} aria-label={t.common.newEvent}>
          <Plus />
        </Button>
      )}
      <Button onClick={() => onToday()} title={t.toolbar.todayTitle}>
        {t.common.today}
      </Button>
      <div className={s.nav}>
        <Button variant="ghost" icon onClick={() => onPrev()} title={`${t.toolbar.back} (←)`} aria-label={t.toolbar.back}>
          <ChevronLeft />
        </Button>
        <Button variant="ghost" icon onClick={() => onNext()} title={`${t.toolbar.forward} (→)`} aria-label={t.toolbar.forward}>
          <ChevronRight />
        </Button>
      </div>
      <h2 className={s.title}>
        {viewTitle(view, cursor)}
        {week && <span className={s.week}>{week}</span>}
      </h2>
      <div className={s.spacer} />
      <Search />
      <FreeSlotsButton />
      <Button
        variant="ghost"
        icon
        onClick={() => onRefresh()}
        title={t.toolbar.refresh}
        aria-label={t.toolbar.refresh}
        className={cx(loading && s.spinning)}
      >
        <Refresh />
      </Button>
      <SettingsButton />
      <div className={s.segmented} role="tablist" aria-label={t.toolbar.view}>
        {VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={view === v.id}
            className={cx(s.segment, view === v.id && s.active)}
            onClick={() => onView(v.id)}
            title={`${t.toolbar.views[v.id]} (${v.key})`}
          >
            {t.toolbar.views[v.id]}
          </button>
        ))}
      </div>
      <ViewMenu className={s.viewMenu} views={VIEWS} value={view} onChange={onView} />
    </header>
  );
};
