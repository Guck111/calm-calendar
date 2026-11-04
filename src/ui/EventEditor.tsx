import { useUnit } from "effector-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { $calendarById, $writableCalendars } from "../model/calendars";
import {
  $busy,
  $draft,
  $editorError,
  deleteClicked,
  draftChanged,
  editorClosed,
  saveClicked,
} from "../model/editor";
import { Button, cx } from "./Button";
import { Close, External } from "./icons";
import s from "./EventEditor.module.css";

export const EventEditor = () => {
  const [draft, error, busy, writable, byId] = useUnit([
    $draft,
    $editorError,
    $busy,
    $writableCalendars,
    $calendarById,
  ]);
  const [change, close, save, remove] = useUnit([draftChanged, editorClosed, saveClicked, deleteClicked]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const draftKey = draft ? `${draft.originalCalendarId}:${draft.id}` : "";
  useEffect(() => setConfirmDelete(false), [draftKey]);

  useEffect(() => {
    if (!draft) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft, close]);

  if (!draft) return null;

  const calendar = byId.get(draft.originalCalendarId ?? draft.calendarId);
  const readOnly = Boolean(draft.id) && !writable.some((c) => c.id === draft.originalCalendarId);
  // перенос повторяющегося события в другой календарь Google не поддерживает для одного повторения
  const calendarLocked = readOnly || (Boolean(draft.id) && draft.recurring);
  const isNew = !draft.id;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!readOnly) save();
  };

  return (
    <div className={s.backdrop} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <form
        className={s.dialog}
        onSubmit={onSubmit}
        role="dialog"
        aria-modal="true"
        aria-label={isNew ? "Новое событие" : "Событие"}
        style={{ "--c": calendar?.color ?? "var(--accent)" } as CSSProperties}
      >
        <div className={s.head}>
          <input
            className={s.title}
            value={draft.title}
            onChange={(e) => change({ title: e.target.value })}
            placeholder="Название"
            autoFocus={isNew}
            readOnly={readOnly}
          />
          <Button variant="ghost" icon onClick={() => close()} aria-label="Закрыть">
            <Close />
          </Button>
        </div>

        <label className={s.check}>
          <input
            type="checkbox"
            checked={draft.allDay}
            onChange={(e) => change({ allDay: e.target.checked })}
            disabled={readOnly}
          />
          Весь день
        </label>

        <div className={cx(s.times, draft.allDay && s.datesOnly)}>
          <span className={s.timeLabel}>Начало</span>
          <input
            type="date"
            value={draft.startDate}
            onChange={(e) => e.target.value && change({ startDate: e.target.value })}
            disabled={readOnly}
            aria-label="Дата начала"
          />
          {!draft.allDay && (
            <input
              type="time"
              value={draft.startTime}
              step={300}
              onChange={(e) => e.target.value && change({ startTime: e.target.value })}
              disabled={readOnly}
              aria-label="Время начала"
            />
          )}
          <span className={s.timeLabel}>Конец</span>
          <input
            type="date"
            value={draft.endDate}
            onChange={(e) => e.target.value && change({ endDate: e.target.value })}
            disabled={readOnly}
            aria-label="Дата конца"
          />
          {!draft.allDay && (
            <input
              type="time"
              value={draft.endTime}
              step={300}
              onChange={(e) => e.target.value && change({ endTime: e.target.value })}
              disabled={readOnly}
              aria-label="Время конца"
            />
          )}
        </div>

        <label className={s.field}>
          <span>Календарь</span>
          {calendarLocked ? (
            <div className={s.static}>
              <i className={s.swatch} />
              {calendar?.name ?? draft.calendarId}
            </div>
          ) : (
            <select value={draft.calendarId} onChange={(e) => change({ calendarId: e.target.value })}>
              {writable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </label>

        <label className={s.field}>
          <span>Место</span>
          <input
            value={draft.location}
            onChange={(e) => change({ location: e.target.value })}
            readOnly={readOnly}
          />
        </label>

        <label className={s.field}>
          <span>Описание</span>
          <textarea
            rows={3}
            value={draft.description}
            onChange={(e) => change({ description: e.target.value })}
            readOnly={readOnly}
          />
        </label>

        {draft.recurring && !readOnly && (
          <p className={s.note}>Повторяющееся событие: изменения коснутся только этого повторения.</p>
        )}
        {readOnly && <p className={s.note}>Календарь только для чтения.</p>}
        {error && <p className={s.error}>{error}</p>}

        <div className={s.actions}>
          {draft.htmlLink && (
            <Button variant="ghost" onClick={() => openUrl(draft.htmlLink ?? "")} title="Открыть в Google Календаре">
              <External /> В Google
            </Button>
          )}
          <div className={s.spacer} />
          {!isNew && !readOnly && (
            <Button
              danger
              variant="ghost"
              disabled={busy}
              onClick={() => (confirmDelete ? remove() : setConfirmDelete(true))}
            >
              {confirmDelete ? "Точно удалить?" : "Удалить"}
            </Button>
          )}
          {!readOnly && (
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? "Сохраняю…" : "Сохранить"}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
};
