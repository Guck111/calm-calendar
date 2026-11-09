import { useUnit } from "effector-react";
import { t } from "../shared/i18n";
import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { $calendarById, $writableCalendars } from "../model/calendars";
import {
  $askScope,
  $busy,
  $draft,
  $editorError,
  $mode,
  $opened,
  $recurrenceEdited,
  $series,
  deleteClicked,
  draftChanged,
  editCancelled,
  editClicked,
  editorClosed,
  saveClicked,
  scopeCancelled,
  scopeChosen,
} from "../model/editor";
import { openExternal } from "../shared/api/open";
import type { CalendarEvent } from "../shared/api/types";
import { addDays, formatFullDate, formatTime, isSameDay } from "../shared/lib/date";
import { describeRule, parseRecurrence } from "../shared/lib/rrule";
import { RepeatField } from "./RepeatField";
import { Button, cx } from "./Button";
import { Close, External, Video } from "./icons";
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

type DeleteProps = {
  busy: boolean;
  onConfirm: () => void;
  resetKey: string;
  /** у повторения серии подтверждением служит вопрос «только это или это и следующие» */
  askFirst?: boolean;
};

const DeleteButton = ({ busy, onConfirm, resetKey, askFirst = true }: DeleteProps) => {
  const [confirm, setConfirm] = useState(false);
  useEffect(() => setConfirm(false), [resetKey]);
  return (
    <Button
      danger
      variant="ghost"
      disabled={busy}
      onClick={() => (confirm || !askFirst ? onConfirm() : setConfirm(true))}
    >
      {confirm ? t.editor.confirmDelete : t.editor.delete}
    </Button>
  );
};

const GoogleLink = ({ href }: { href?: string }) =>
  href ? (
    <Button variant="ghost" onClick={() => void openExternal(href)} title={t.editor.openInGoogle}>
      <External /> {t.editor.inGoogle}
    </Button>
  ) : null;

/** Вопрос перед сохранением или удалением повторения серии */
const ScopePrompt = ({ kind }: { kind: "save" | "delete" }) => {
  const [busy, edited, choose, cancel] = useUnit([$busy, $recurrenceEdited, scopeChosen, scopeCancelled]);
  // новое правило может начаться только с этого повторения
  const onlyFollowing = kind === "save" && edited;
  const title = kind === "save" ? t.scope.saveTitle : t.scope.deleteTitle;
  return (
    <div className={s.scope} role="group" aria-label={title}>
      <p className={s.scopeTitle}>{title}</p>
      {onlyFollowing && <p className={s.note}>{t.scope.ruleChanged}</p>}
      <div className={s.actions}>
        <div className={s.spacer} />
        <Button variant="ghost" onClick={() => cancel()} disabled={busy}>
          {t.common.cancel}
        </Button>
        {!onlyFollowing && (
          // у удаления обе кнопки красные, без заливки: синий фон с красным текстом не читается
          <Button
            variant={kind === "delete" ? "default" : "primary"}
            danger={kind === "delete"}
            onClick={() => choose("this")}
            disabled={busy}
            autoFocus
          >
            {t.scope.this}
          </Button>
        )}
        <Button
          variant={onlyFollowing ? "primary" : "default"}
          danger={kind === "delete"}
          onClick={() => choose("following")}
          disabled={busy}
          autoFocus={onlyFollowing}
        >
          {t.scope.following}
        </Button>
      </div>
    </div>
  );
};

/** «Каждую неделю, по пн и ср» у повторения серии; пока правило грузится — просто «повторяющееся» */
const SeriesNote = ({ event }: { event: CalendarEvent }) => {
  const series = useUnit($series);
  const lines = series?.id === event.recurringEventId ? series?.lines : null;
  const text = lines?.length ? describeRule(parseRecurrence(lines, event.start).rule, event.start) : t.editor.recurring;
  return <p className={s.note}>{text}</p>;
};

/** Карточка события: только просмотр, правка по кнопке */
const EventDetails = ({ event, editable }: { event: CalendarEvent; editable: boolean }) => {
  const [byId, busy, error, ask, close, edit, remove] = useUnit([
    $calendarById,
    $busy,
    $editorError,
    $askScope,
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
      {event.meeting && (
        <Button
          variant="primary"
          className={s.join}
          onClick={() => event.meeting && void openExternal(event.meeting.url)}
          title={t.meeting.joinTitle(event.meeting.provider)}
          autoFocus
        >
          <Video /> {t.meeting.join}
          <span className={s.provider}>{event.meeting.provider}</span>
        </Button>
      )}
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
      {event.recurring && <SeriesNote event={event} />}
      {!editable && <p className={s.note}>{t.editor.readOnly}</p>}
      {error && <p className={s.error}>{error}</p>}
      {ask === "delete" ? (
        <ScopePrompt kind="delete" />
      ) : (
        <div className={s.actions}>
          <GoogleLink href={event.htmlLink} />
          <div className={s.spacer} />
          {editable && (
            <DeleteButton busy={busy} onConfirm={() => remove()} resetKey={event.key} askFirst={!event.recurring} />
          )}
          {editable && (
            <Button variant={event.meeting ? "default" : "primary"} onClick={() => edit()} autoFocus={!event.meeting}>
              {t.editor.edit}
            </Button>
          )}
        </div>
      )}
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
  const [draft, error, busy, writable, byId, ask, series] = useUnit([
    $draft,
    $editorError,
    $busy,
    $writableCalendars,
    $calendarById,
    $askScope,
    $series,
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
  const calendarLocked = !isNew && Boolean(draft.recurringEventId);
  // правило серии ещё грузится; если не загрузилось, поле не показываем: правка одного повторения работает и без него
  const seriesFailed = Boolean(series?.failed && series.id === draft.recurringEventId);
  const seriesLoading = Boolean(draft.recurringEventId) && draft.originalRecurrence === undefined && !seriesFailed;

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

      {!seriesFailed && (
        <RepeatField draft={draft} loading={seriesLoading} onChange={(recurrence) => change({ recurrence })} />
      )}

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

      {error && <p className={s.error}>{error}</p>}

      {ask ? (
        <ScopePrompt kind={ask} />
      ) : (
        <div className={s.actions}>
          {!isNew && (
            <DeleteButton
              busy={busy}
              onConfirm={() => remove()}
              resetKey={draft.id ?? ""}
              askFirst={!draft.recurringEventId}
            />
          )}
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
      )}
    </form>
  );
};

export const EventEditor = () => {
  const [draft, opened, mode, writable, byId, ask, close, cancel, cancelScope] = useUnit([
    $draft,
    $opened,
    $mode,
    $writableCalendars,
    $calendarById,
    $askScope,
    editorClosed,
    editCancelled,
    scopeCancelled,
  ]);

  useEffect(() => {
    if (!draft) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // сначала закрывается вопрос о повторениях
      if (ask) return cancelScope();
      // из правки существующего события Esc возвращает к просмотру
      if (mode === "edit" && opened) cancel();
      else close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft, mode, opened, ask, close, cancel, cancelScope]);

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
