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
import { UndoToast } from "../ui/UndoToast";
import { Welcome } from "../ui/Welcome";
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

/** Timers, refresh on returning to the window, and hotkeys */
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

  // widget asks to open a specific day
  useEffect(() => {
    const fromQuery = new URLSearchParams(window.location.search).get("date");
    if (fromQuery) openDay(fromDateKey(fromQuery));
    const offDate = subscribe<{ date: string }>("open-date", ({ date }) => openDay(fromDateKey(date)));
    // Ctrl+Enter in the widget input: open the form with filled fields
    const offDraft = subscribe<EventDraft>("open-draft", (draft) => {
      openDay(fromDateKey(draft.startDate));
      openDraft(draft);
    });
    // event was created from the widget
    const offChanged = subscribe<{ from?: string }>("events-changed", (p) => p?.from !== "main" && reload());
    // second time zone, week numbers, holidays changed in the settings window
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
    // tick exactly at the minute boundary so the "now" line doesn't lag
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
      // in right-to-left, the left arrow goes forward, like the buttons
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
      // on a selected event, arrows move between events (useEventKeys), not between weeks
      if (e.key.startsWith("Arrow") && eventElement(e.target)) return;
      // e.code doesn't depend on the keyboard layout: works with Russian too
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

/** Bar above the calendar: load error or "offline", with a "Retry" button.
 *  Retry happens on its own anyway after 5 seconds, 15 seconds and a minute (model/sync) */
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
      <UndoToast />
      <Welcome />
      <CommandMenu />
      <Shortcuts />
    </div>
  );
};
