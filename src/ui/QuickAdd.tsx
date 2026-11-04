import { forwardRef, useImperativeHandle, useRef, useState, type KeyboardEvent } from "react";
import type { EventDraft } from "../shared/api/types";
import { parseQuick, quickToDraft, quickWhen, type QuickCalendar } from "../shared/lib/quick";
import { cx } from "./Button";
import s from "./QuickAdd.module.css";

type Props = {
  /** календари, куда можно записывать; первый — по умолчанию */
  calendars: QuickCalendar[];
  onCreate: (draft: EventDraft) => Promise<void>;
  /** Ctrl+Enter: открыть полную форму с заполненными полями */
  onExpand: (draft: EventDraft) => void;
  variant?: "main" | "widget";
};

export type QuickAddHandle = { focus: () => void };

const PLACEHOLDER = "завтра 19:00 английский 50 мин";

export const QuickAdd = forwardRef<QuickAddHandle, Props>(({ calendars, onCreate, onExpand, variant = "main" }, ref) => {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }));

  const trimmed = text.trim();
  const result = trimmed ? parseQuick(trimmed, new Date(), calendars) : null;
  const fallback = calendars[0]?.id ?? "";
  const calendarName = calendars.find((c) => c.id === (result?.calendarId ?? fallback))?.name;

  const submit = async (expand: boolean) => {
    if (!result || busy) return;
    const draft = quickToDraft(result, fallback);
    if (expand) {
      onExpand(draft);
      setText("");
      return;
    }
    if (!result.title) {
      setError("Добавь название");
      return;
    }
    if (!fallback) {
      setError("Нет календаря, куда можно записать событие");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate(draft);
      setText("");
    } catch (e) {
      setError(e && typeof e === "object" && "message" in e ? String(e.message) : "Не удалось создать событие");
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void submit(e.ctrlKey || e.metaKey);
    }
    if (e.key === "Escape") {
      setText("");
      setError(null);
      input.current?.blur();
    }
  };

  return (
    <div className={cx(s.quick, variant === "widget" && s.widget)}>
      <input
        ref={input}
        className={s.input}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        onKeyDown={onKeyDown}
        placeholder={variant === "widget" ? "+ Новое событие" : `Например: ${PLACEHOLDER}`}
        disabled={busy}
        spellCheck={false}
        aria-label="Быстрое создание события"
      />
      {result && (
        <div className={s.preview} aria-live="polite">
          {error ? (
            <span className={s.error}>{error}</span>
          ) : (
            <>
              <span className={s.title}>{result.title || "без названия"}</span>
              <span>{quickWhen(result)}</span>
              {calendarName && <span>{calendarName}</span>}
              {result.location && <span>{result.location}</span>}
              <span className={s.keys}>Enter — создать · Ctrl+Enter — подробнее</span>
            </>
          )}
        </div>
      )}
    </div>
  );
});
