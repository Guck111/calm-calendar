import { useUnit } from "effector-react";
import { useEffect, useRef } from "react";
import { $undo, undoClicked, undoDismissed, undoPaused, undoResumed } from "../model/undo";
import { t } from "../shared/i18n";
import { Close } from "./icons";
import s from "./UndoToast.module.css";

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/** The "Moved: … · Undo" bar at the bottom of the window. Ctrl+Z undoes too; while the mouse or focus is on the bar,
 *  it doesn't disappear. When the window is closed, the deletion goes to Google right away */
export const UndoToast = () => {
  const [undo, undoIt, dismiss, pause, resume] = useUnit([$undo, undoClicked, undoDismissed, undoPaused, undoResumed]);

  useEffect(() => {
    if (!undo) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === "KeyZ" && !isTyping(e.target)) {
        e.preventDefault();
        undoIt();
      }
    };
    const onLeave = () => dismiss();
    window.addEventListener("keydown", onKey);
    window.addEventListener("pagehide", onLeave);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pagehide", onLeave);
    };
  }, [undo, undoIt, dismiss]);

  // mouse and focus hold the bar independently: the timer runs again only when both have left
  const inside = useRef({ hover: false, focus: false });
  const enter = (what: "hover" | "focus") => {
    const was = inside.current.hover || inside.current.focus;
    inside.current[what] = true;
    if (!was) pause();
  };
  const leave = (what: "hover" | "focus") => {
    inside.current[what] = false;
    if (!inside.current.hover && !inside.current.focus) resume();
  };
  // a new bar starts from a clean slate
  useEffect(() => {
    inside.current = { hover: false, focus: false };
  }, [undo?.kind, undo?.title]);

  // polite announcement: a screen reader reads the bar without taking focus. Not role="status" —
  // that's the role of the error bar above the calendar
  return (
    <div className={s.region} aria-live="polite" aria-atomic="true">
      {undo && (
        <div
          key={undo.kind + undo.title}
          className={s.toast}
          onMouseEnter={() => enter("hover")}
          onMouseLeave={() => leave("hover")}
          onFocus={() => enter("focus")}
          onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && leave("focus")}
        >
          <span className={s.text}>
            {undo.kind === "moved" ? t.editor.undoMoved(undo.title) : t.editor.undoDeleted(undo.title)}
          </span>
          <button type="button" className={s.undo} onClick={() => undoIt()} title="Ctrl+Z">
            {t.editor.undo}
          </button>
          <button type="button" className={s.close} onClick={() => dismiss()} aria-label={t.common.close}>
            <Close size={14} />
          </button>
        </div>
      )}
    </div>
  );
};
