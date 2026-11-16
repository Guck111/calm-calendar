import { useUnit } from "effector-react";
import { useEffect, useRef } from "react";
import { $undo, undoClicked, undoDismissed, undoPaused, undoResumed } from "../model/undo";
import { t } from "../shared/i18n";
import { Close } from "./icons";
import s from "./UndoToast.module.css";

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/** Строка «Перенесено: … · Отменить» внизу окна. Ctrl+Z тоже отменяет; пока мышь или фокус на строке,
 *  она не исчезает. Окно закрывают — удаление уходит в Google сразу */
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

  // мышь и фокус держат строку независимо: таймер снова идёт, только когда ушли оба
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
  // новая строка — с чистого листа
  useEffect(() => {
    inside.current = { hover: false, focus: false };
  }, [undo?.kind, undo?.title]);

  // вежливое объявление: экранный диктор прочитает строку, не забирая фокус. Не role="status" —
  // это роль полосы ошибок над календарём
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
