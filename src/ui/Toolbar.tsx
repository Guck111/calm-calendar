import { useUnit } from "effector-react";
import { $loading, refreshRequested } from "../model/events";
import { $cursor, $view, nextClicked, prevClicked, todayClicked, viewChanged } from "../model/view";
import { viewTitle, type ViewMode } from "../shared/lib/date";
import { Button, cx } from "./Button";
import { ChevronLeft, ChevronRight, Refresh } from "./icons";
import s from "./Toolbar.module.css";

const VIEWS: { id: ViewMode; label: string; key: string }[] = [
  { id: "day", label: "День", key: "D" },
  { id: "week", label: "Неделя", key: "W" },
  { id: "month", label: "Месяц", key: "M" },
];

export const Toolbar = () => {
  const [view, cursor, loading] = useUnit([$view, $cursor, $loading]);
  const [onPrev, onNext, onToday, onView, onRefresh] = useUnit([
    prevClicked,
    nextClicked,
    todayClicked,
    viewChanged,
    refreshRequested,
  ]);

  return (
    <header className={s.bar}>
      <Button onClick={() => onToday()} title="Сегодня (T)">
        Сегодня
      </Button>
      <div className={s.nav}>
        <Button variant="ghost" icon onClick={() => onPrev()} title="Назад (←)" aria-label="Назад">
          <ChevronLeft />
        </Button>
        <Button variant="ghost" icon onClick={() => onNext()} title="Вперёд (→)" aria-label="Вперёд">
          <ChevronRight />
        </Button>
      </div>
      <h2 className={s.title}>{viewTitle(view, cursor)}</h2>
      <div className={s.spacer} />
      <Button
        variant="ghost"
        icon
        onClick={() => onRefresh()}
        title="Обновить"
        aria-label="Обновить"
        className={cx(loading && s.spinning)}
      >
        <Refresh />
      </Button>
      <div className={s.segmented} role="tablist" aria-label="Вид">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={view === v.id}
            className={cx(s.segment, view === v.id && s.active)}
            onClick={() => onView(v.id)}
            title={`${v.label} (${v.key})`}
          >
            {v.label}
          </button>
        ))}
      </div>
    </header>
  );
};
