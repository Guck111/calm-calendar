import { useUnit } from "effector-react";
import { useEffect } from "react";
import { subscribe } from "../shared/api/bus";
import { fromDateKey } from "../shared/lib/date";
import { $signedIn, $status, appStarted } from "../model/auth";
import { $draft, draftOpened } from "../model/editor";
import { quickFocusRequested } from "../model/quick";
import "../model/reminders";
import type { EventDraft } from "../shared/api/types";
import { $loadError, refreshRequested, reloadRequested } from "../model/events";
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
import { EventEditor } from "../ui/EventEditor";
import { MonthView } from "../ui/MonthView";
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
    return () => {
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
      ArrowLeft: () => prev(),
      ArrowRight: () => next(),
      t: () => today(),
      d: () => setView("day"),
      w: () => setView("week"),
      m: () => setView("month"),
      n: () => create(),
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
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

export const App = () => {
  const [status, signedIn, view, draft, loadError] = useUnit([$status, $signedIn, $view, $draft, $loadError]);
  useAppEffects(signedIn, Boolean(draft));

  if (!status) return <div className={s.splash} />;
  if (!signedIn) return <AuthScreen />;

  return (
    <div className={s.app}>
      <Sidebar />
      <main className={s.main}>
        <Toolbar />
        {loadError && <div className={s.banner}>{loadError}</div>}
        <div className={s.view}>{view === "month" ? <MonthView /> : <TimeGrid />}</div>
      </main>
      <EventEditor />
    </div>
  );
};
