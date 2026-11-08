import { useUnit } from "effector-react";
import { t } from "../shared/i18n";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { $calendarById, $writableCalendars } from "../model/calendars";
import {
  $busy,
  $draft,
  $editorError,
  $mode,
  $opened,
  deleteClicked,
  draftChanged,
  editCancelled,
  editClicked,
  editorClosed,
  saveClicked,
} from "../model/editor";
import type { CalendarEvent } from "../shared/api/types";
import { addDays, formatFullDate, formatTime, isSameDay } from "../shared/lib/date";
import { Button, cx } from "./Button";
import { Close, External } from "./icons";
import s from "./EventEditor.module.css";

const formatWhen = (e: CalendarEvent): string => {
  if (e.allDay) {
    const last = addDays(e.end, -1);
    return isSameDay(e.start, last)
      ? t.editor.allDayDate(formatFullDate(e.start))
      : `${formatFullDate(e.start)} — ${formatFullDate(last)}`;
  }
  return isSameDay(e.start, e.end)
    ? `${formatFullDate(e.start)}, ${formatTime(e.start)}–${formatTime(e.end)}`
    : `${formatFullDate(e.start)}, ${formatTime(e.start)} — ${formatFullDate(e.end)}, ${formatTime(e.end)}`;
};

// Google хранит описание то текстом, то простым HTML: показываем как текст
const plainText = (html: string): string =>
  html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();

const DeleteButton = ({ busy, onConfirm, resetKey }: { busy: boolean; onConfirm: () => void; resetKey: string }) => {
  const [confirm, setConfirm] = useState(false);
  useEffect(() => setConfirm(false), [resetKey]);
  return (
    <Button danger variant="ghost" disabled={busy} onClick={() => (confirm ? onConfirm() : setConfirm(true))}>
      {confirm ? t.editor.confirmDelete : t.editor.delete}
    </Button>
  );
};

const GoogleLink = ({ href }: { href?: string }) =>
  href ? (
    <Button variant="ghost" onClick={() => openUrl(href)} title={t.editor.openInGoogle}>
      <External /> {t.editor.inGoogle}
    </Button>
  ) : null;

/** Карточка события: только просмотр, правка по кнопке */
const EventDetails = ({ event, editable }: { event: CalendarEvent; editable: boolean }) => {
  const [byId, busy, error, close, edit, remove] = useUnit([
    $calendarById,
    $busy,
    $editorError,
    editorClosed,
    editClicked,
    deleteClicked,
  ]);
  const calendar = byId.get(event.calendarId);
  return (
    <>
      <div className={s.head}>
        <h2 className={s.viewTitle}>{event.title}</h2>
        <Button variant="ghost" icon onClick={() => close()} aria-label={t.common.close}>
          <Close />
        </Button>
      </div>
      <p className={s.when}>{formatWhen(event)}</p>
      <dl className={s.details}>
        <dt>{t.common.calendar}</dt>
        <dd>
          <i className={s.swatch} />
          {calendar?.name ?? event.calendarId}
        </dd>
        {event.location && (
          <>
            <dt>{t.common.location}</dt>
            <dd>{event.location}</dd>
          </>
        )}
        {event.description && (
          <>
            <dt>{t.common.description}</dt>
            <dd className={s.description}>{plainText(event.description)}</dd>
          </>
        )}
      </dl>
      {event.recurring && <p className={s.note}>{t.editor.recurring}</p>}
      {!editable && <p className={s.note}>{t.editor.readOnly}</p>}
      {error && <p className={s.error}>{error}</p>}
      <div className={s.actions}>
        <GoogleLink href={event.htmlLink} />
        <div className={s.spacer} />
        {editable && <DeleteButton busy={busy} onConfirm={() => remove()} resetKey={event.key} />}
        {editable && (
          <Button variant="primary" onClick={() => edit()} autoFocus>
            {t.editor.edit}
          </Button>
        )}
      </div>
    </>
  );
};

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className={s.field}>
    <span>{label}</span>
    {children}
  </label>
);

/** Форма создания и правки */
const EventForm = () => {
  const [draft, error, busy, writable, byId] = useUnit([
    $draft,
    $editorError,
    $busy,
    $writableCalendars,
    $calendarById,
  ]);
  const [change, close, save, cancel, remove] = useUnit([
    draftChanged,
    editorClosed,
    saveClicked,
    editCancelled,
    deleteClicked,
  ]);
  if (!draft) return null;

  const isNew = !draft.id;
  const calendar = byId.get(draft.originalCalendarId ?? draft.calendarId);
  // перенести одно повторение в другой календарь Google не позволяет
  const calendarLocked = !isNew && draft.recurring;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save();
  };

  return (
    <form className={s.form} onSubmit={onSubmit}>
      <div className={s.head}>
        <input
          className={s.title}
          value={draft.title}
          onChange={(e) => change({ title: e.target.value })}
          placeholder={t.editor.titlePlaceholder}
          autoFocus
        />
        <Button variant="ghost" icon onClick={() => close()} aria-label={t.common.close}>
          <Close />
        </Button>
      </div>

      <label className={s.check}>
        <input type="checkbox" checked={draft.allDay} onChange={(e) => change({ allDay: e.target.checked })} />
        {t.common.allDay}
      </label>

      <div className={cx(s.times, draft.allDay && s.datesOnly)}>
        <span className={s.timeLabel}>{t.editor.start}</span>
        <input
          type="date"
          value={draft.startDate}
          onChange={(e) => e.target.value && change({ startDate: e.target.value })}
          aria-label={t.editor.startDate}
        />
        {!draft.allDay && (
          <input
            type="time"
            value={draft.startTime}
            step={300}
            onChange={(e) => e.target.value && change({ startTime: e.target.value })}
            aria-label={t.editor.startTime}
          />
        )}
        <span className={s.timeLabel}>{t.editor.end}</span>
        <input
          type="date"
          value={draft.endDate}
          onChange={(e) => e.target.value && change({ endDate: e.target.value })}
          aria-label={t.editor.endDate}
        />
        {!draft.allDay && (
          <input
            type="time"
            value={draft.endTime}
            step={300}
            onChange={(e) => e.target.value && change({ endTime: e.target.value })}
            aria-label={t.editor.endTime}
          />
        )}
      </div>

      <Field label={t.common.calendar}>
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
      </Field>

      <Field label={t.common.location}>
        <input value={draft.location} onChange={(e) => change({ location: e.target.value })} />
      </Field>

      <Field label={t.common.description}>
        <textarea rows={3} value={draft.description} onChange={(e) => change({ description: e.target.value })} />
      </Field>

      {draft.recurring && <p className={s.note}>{t.editor.recurringNote}</p>}
      {error && <p className={s.error}>{error}</p>}

      <div className={s.actions}>
        {!isNew && <DeleteButton busy={busy} onConfirm={() => remove()} resetKey={draft.id ?? ""} />}
        <div className={s.spacer} />
        {!isNew && (
          <Button variant="ghost" onClick={() => cancel()} disabled={busy}>
            {t.common.cancel}
          </Button>
        )}
        <Button variant="primary" type="submit" disabled={busy}>
          {busy ? t.common.saving : t.common.save}
        </Button>
      </div>
    </form>
  );
};

export const EventEditor = () => {
  const [draft, opened, mode, writable, byId, close, cancel] = useUnit([
    $draft,
    $opened,
    $mode,
    $writableCalendars,
    $calendarById,
    editorClosed,
    editCancelled,
  ]);

  useEffect(() => {
    if (!draft) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // из правки существующего события Esc возвращает к просмотру
      if (mode === "edit" && opened) cancel();
      else close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft, mode, opened, close, cancel]);

  if (!draft) return null;

  const calendar = byId.get(draft.calendarId);
  const editable = !opened || writable.some((c) => c.id === opened.calendarId);

  return (
    <div className={s.backdrop} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        className={s.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={draft.id ? t.common.event : t.common.newEvent}
        style={{ "--c": calendar?.color ?? "var(--accent)" } as CSSProperties}
      >
        {mode === "view" && opened ? <EventDetails event={opened} editable={editable} /> : <EventForm />}
      </div>
    </div>
  );
};
