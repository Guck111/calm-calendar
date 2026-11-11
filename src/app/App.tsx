import { useUnit } from "effector-react";
import { useEffect } from "react";
import { subscribe } from "../shared/api/bus";
import { isRtl, t } from "../shared/i18n";
import { fromDateKey } from "../shared/lib/date";
import { $signedIn, $status, appStarted } from "../model/auth";
import { $draft, draftOpened } from "../model/editor";
import { quickFocusRequested } from "../model/quick";
import "../model/reminders";
import type { EventDraft } from "../shared/api/types";
import { $loadError, $loading, refreshRequested, reloadRequested } from "../model/events";
import { retryClicked } from "../model/sync";
import { displayReloaded } from "../model/display";
import { secondZoneReloaded } from "../model/zones";
import { $offlineText } from "../model/connection";
import {
  $view,
  dayOpened,
  minuteTicked,
  nextClicked,
  prevClicked,
  todayClicked,
  viewChanged,
} from "../model/view";
import { AuthScreen } from "../ui/AuthScreen";
import { eventElement, useEventKeys } from "./useEventKeys";
import { EventEditor } from "../ui/EventEditor";
import { CommandMenu } from "../ui/CommandMenu";
import { Shortcuts } from "../ui/Shortcuts";
import { MonthView } from "../ui/MonthView";
import { ScheduleView } from "../ui/ScheduleView";
import { Sidebar } from "../ui/Sidebar";
import { TimeGrid } from "../ui/TimeGrid";
import { Toolbar } from "../ui/Toolbar";
import s from "./App.module.css";

const AUTO_REFRESH_MS = 5 * 60_000;

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/** Таймеры, обновление при возврате в окно и горячие клавиши */
const useAppEffects = (signedIn: boolean, editorOpen: boolean) => {
  const [start, tick, refresh] = useUnit([appStarted, minuteTicked, refreshRequested]);
  const [prev, next, today, setView, create] = useUnit([
    prevClicked,
    nextClicked,
    todayClicked,
    viewChanged,
    quickFocusRequested,
  ]);

  const [openDay, openDraft, reload] = useUnit([dayOpened, draftOpened, reloadRequested]);

  useEffect(() => start(), [start]);

  // виджет просит открыть конкретный день
  useEffect(() => {
    const fromQuery = new URLSearchParams(window.location.search).get("date");
    if (fromQuery) openDay(fromDateKey(fromQuery));
    const offDate = subscribe<{ date: string }>("open-date", ({ date }) => openDay(fromDateKey(date)));
    // Ctrl+Enter в строке виджета: открыть форму с заполненными полями
    const offDraft = subscribe<EventDraft>("open-draft", (draft) => {
      openDay(fromDateKey(draft.startDate));
      openDraft(draft);
    });
    // событие создали из виджета
    const offChanged = subscribe<{ from?: string }>("events-changed", (p) => p?.from !== "main" && reload());
    // второй пояс, номера недель, праздники сменили в окне настроек
    const offDisplay = subscribe("display-changed", () => {
      secondZoneReloaded();
      displayReloaded();
    });
    return () => {
      offDisplay();
      offDate();
      offDraft();
      offChanged();
    };
  }, [openDay, openDraft, reload]);

  useEffect(() => {
    // тикаем ровно на границе минуты, чтобы линия «сейчас» не отставала
    let interval: number | undefined;
    const timeout = window.setTimeout(() => {
      tick(new Date());
      interval = window.setInterval(() => tick(new Date()), 60_000);
    }, 60_000 - (Date.now() % 60_000));
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [tick]);

  useEffect(() => {
    if (!signedIn) return;
    let last = Date.now();
    const maybeRefresh = () => {
      if (Date.now() - last < 30_000) return;
      last = Date.now();
      refresh();
    };
    const onVisible = () => document.visibilityState === "visible" && maybeRefresh();
    const interval = window.setInterval(() => {
      last = Date.now();
      refresh();
    }, AUTO_REFRESH_MS);
    window.addEventListener("focus", maybeRefresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", maybeRefresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [signedIn, refresh]);

  useEffect(() => {
    if (!signedIn || editorOpen) return;
    const actions: Record<string, () => void> = {
      // справа налево стрелка влево ведёт вперёд, как и кнопки
      ArrowLeft: () => (isRtl() ? next() : prev()),
      ArrowRight: () => (isRtl() ? prev() : next()),
      t: () => today(),
      d: () => setView("day"),
      w: () => setView("week"),
      m: () => setView("month"),
      a: () => setView("agenda"),
      n: () => create(),
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      // на выбранном событии стрелки ходят между событиями (useEventKeys), а не по неделям
      if (e.key.startsWith("Arrow") && eventElement(e.target)) return;
      // e.code не зависит от раскладки: работает и на русской
      const key = e.key.startsWith("Arrow") ? e.key : e.code.replace(/^Key/, "").toLowerCase();
      const action = actions[key];
      if (action) {
        e.preventDefault();
        action();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [signedIn, editorOpen, prev, next, today, setView, create]);
};

/** Полоса над календарём: ошибка загрузки или «нет сети», с кнопкой «Повторить».
 *  Повтор и так идёт сам через 5 секунд, 15 секунд и минуту (model/sync) */
const Banner = ({ text }: { text: string }) => {
  const [loading, retry] = useUnit([$loading, retryClicked]);
  return (
    <div className={s.banner} role="status">
      <span>{text}</span>
      <button type="button" className={s.retry} onClick={() => retry()} disabled={loading}>
        {loading ? t.sync.retrying : t.sync.retry}
      </button>
    </div>
  );
};

export const App = () => {
  const [status, signedIn, view, draft, loadError, offline] = useUnit([$status, $signedIn, $view, $draft, $loadError, $offlineText]);
  useAppEffects(signedIn, Boolean(draft));
  useEventKeys(signedIn);

  if (!status) return <div className={s.splash} />;
  if (!signedIn) return <AuthScreen />;

  return (
    <div className={s.app}>
      <Sidebar />
      <main className={s.main}>
        <Toolbar />
        {loadError ? <Banner text={loadError} /> : offline && <Banner text={offline} />}
        <div className={s.view}>{view === "month" ? <MonthView /> : view === "agenda" ? <ScheduleView /> : <TimeGrid />}</div>
      </main>
      <EventEditor />
      <CommandMenu />
      <Shortcuts />
    </div>
  );
};
