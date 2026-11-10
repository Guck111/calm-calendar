import { forwardRef, useImperativeHandle, useRef, useState, type KeyboardEvent } from "react";
import { t } from "../shared/i18n";
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
      setError(t.errors.titleRequired);
      return;
    }
    if (!fallback) {
      setError(t.errors.noWritableCalendar);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate(draft);
      setText("");
    } catch (e) {
      setError(e && typeof e === "object" && "message" in e ? String(e.message) : t.errors.createFailed);
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
        placeholder={variant === "widget" ? t.quick.widgetPlaceholder : t.quick.placeholder(t.quick.example)}
        disabled={busy}
        spellCheck={false}
        aria-label={t.quick.label}
      />
      {result && (
        <div aria-live="polite">
          {error ? (
            <div className={s.preview}>
              <span className={s.error}>{error}</span>
            </div>
          ) : (
            // клик по подсказке — то же, что Enter; фокус остаётся в строке
            <button
              type="button"
              className={cx(s.preview, s.action)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => void submit(e.ctrlKey || e.metaKey)}
              disabled={busy}
            >
              <span className={s.title}>{result.title || t.common.untitledShort}</span>
              <span>{quickWhen(result)}</span>
              {calendarName && <span>{calendarName}</span>}
              {result.location && <span>{result.location}</span>}
              <span className={s.keys}>{t.quick.keys}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
});
