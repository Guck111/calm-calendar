import { useUnit } from "effector-react";
import { t } from "../shared/i18n";
import { $loading, refreshRequested } from "../model/events";
import { $cursor, $view, nextClicked, prevClicked, todayClicked, viewChanged } from "../model/view";
import { viewTitle, type ViewMode } from "../shared/lib/date";
import { useEffect, useState, type JSX } from "react";
import { Button, cx } from "./Button";
import { Search } from "./Search";
import { SettingsButton } from "./Settings";
import { followTheme, nextTheme, readTheme, saveTheme, type Theme } from "../shared/lib/theme";
import { Auto, ChevronLeft, ChevronRight, Moon, Refresh, Sun } from "./icons";
import s from "./Toolbar.module.css";

const VIEWS: { id: ViewMode; key: string }[] = [
  { id: "day", key: "D" },
  { id: "week", key: "W" },
  { id: "month", key: "M" },
];

const THEME_ICON: Record<Theme, (props: { size?: number }) => JSX.Element> = { system: Auto, light: Sun, dark: Moon };

const ThemeButton = () => {
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => followTheme(setTheme), []);
  const Icon = THEME_ICON[theme];
  const next = nextTheme(theme);
  return (
    <Button
      variant="ghost"
      icon
      onClick={() => {
        saveTheme(next);
        setTheme(next);
      }}
      title={t.toolbar.themeTitle(t.toolbar.themeNames[theme], t.toolbar.themeNames[next])}
      aria-label={t.toolbar.theme}
    >
      <Icon />
    </Button>
  );
};

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
      <h2 className={s.title}>{viewTitle(view, cursor)}</h2>
      <div className={s.spacer} />
      <Search />
      <ThemeButton />
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
    </header>
  );
};
