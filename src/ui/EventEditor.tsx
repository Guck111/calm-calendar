import { useUnit } from "effector-react";
import { t } from "../shared/i18n";
import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { $accounts } from "../model/auth";
import { $calendarById, $writableCalendars } from "../model/calendars";
import { $conflicts } from "../model/events";
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
  duplicateClicked,
  editCancelled,
  editClicked,
  editorClosed,
  saveClicked,
  scopeCancelled,
  scopeChosen,
} from "../model/editor";
import { openExternal } from "../shared/api/open";
import { draftZone, hasGuests } from "../shared/api/calendar";
import type { Attendee, Calendar, CalendarEvent, EventDraft } from "../shared/api/types";
import { addDays, formatSpan as travelSpan, formatFullDate, formatShortDate, formatTime, isSameDay, localTimeZone } from "../shared/lib/date";
import { fromZoned, wallClock, zoneLabel } from "../shared/lib/tz";
import { TimeZoneSelect } from "./TimeZoneSelect";
import { describeRule, parseRecurrence } from "../shared/lib/rrule";
import { RepeatField } from "./RepeatField";
import { Button, cx } from "./Button";
import { Close, External, Video, Warning } from "./icons";
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
  // дни недели в правиле — по часам пояса события
  const zone = event.allDay ? undefined : event.timeZone;
  const start = zone ? wallClock(event.start, zone) : event.start;
  const text = lines?.length ? describeRule(parseRecurrence(lines, start, zone).rule, start) : t.editor.recurring;
  return <p className={s.note}>{text}</p>;
};

/** «Пересекается с: Созвон 14:00–15:00 (work@company.com)» — событие из другого аккаунта в то же время */
const ConflictNote = ({ event }: { event: CalendarEvent }) => {
  const conflicts = useUnit($conflicts).get(event.key);
  if (!conflicts?.length) return null;
  const list = conflicts
    .map((c) => `${c.title} ${formatTime(c.start)}–${formatTime(c.end)} (${c.account})`)
    .join(", ");
  return (
    <p className={s.conflict}>
      <Warning /> {t.accounts.conflict(list)}
    </p>
  );
};

/** «9:00–10:00 (GMT−05:00) Северная Америка, восточное время — New York» у события в чужом поясе */
const ZoneNote = ({ event }: { event: CalendarEvent }) => {
  const zone = event.timeZone;
  if (event.allDay || !zone || zone === localTimeZone()) return null;
  const range = `${formatTime(wallClock(event.start, zone))}–${formatTime(wallClock(event.end, event.endTimeZone ?? zone))}`;
  return (
    <p className={s.note}>
      {range} {zoneLabel(zone, event.start)}
      {event.endTimeZone && ` → ${zoneLabel(event.endTimeZone, event.end)}`}
    </p>
  );
};

/** «По вашему времени: Чт, 5 нояб., 0:30–1:30» в форме, если пояс события не системный */
const LocalTimeNote = ({ draft }: { draft: EventDraft }) => {
  const zone = draftZone(draft);
  if (zone === localTimeZone()) return null;
  const start = fromZoned(draft.startDate, draft.startTime, zone);
  const end = fromZoned(draft.endDate, draft.endTime, draft.endTimeZone ?? zone);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const text = isSameDay(start, end)
    ? `${formatShortDate(start)}, ${formatTime(start)}–${formatTime(end)}`
    : `${formatShortDate(start)}, ${formatTime(start)} — ${formatShortDate(end)}, ${formatTime(end)}`;
  return <p className={s.note}>{t.editor.yourTime(text)}</p>;
};

/** Карточка события: только просмотр, правка по кнопке */
const EventDetails = ({ event, editable }: { event: CalendarEvent; editable: boolean }) => {
  const [byId, accounts, busy, error, ask, close, edit, remove, duplicate, writable] = useUnit([
    $calendarById,
    $accounts,
    $busy,
    $editorError,
    $askScope,
    editorClosed,
    editClicked,
    deleteClicked,
    duplicateClicked,
    $writableCalendars,
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
      <ZoneNote event={event} />
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
          {accounts.length > 1 && <span className={s.accountName}>{event.account}</span>}
        </dd>
        {event.alsoIn?.length ? (
          <dd className={s.alsoIn}>
            {t.accounts.alsoIn(event.alsoIn.map((id) => byId.get(id)?.account ?? id).join(", "))}
          </dd>
        ) : null}
        {event.travelMinutes && !event.allDay ? (
          <>
            <dt>{t.editor.travel}</dt>
            <dd>{travelSpan(event.travelMinutes)}</dd>
          </>
        ) : null}
        {event.location && (
          <>
            <dt>{t.common.location}</dt>
            <dd>{event.location}</dd>
          </>
        )}
        {event.attendees?.length ? (
          <>
            <dt>{t.editor.guests}</dt>
            <dd>
              <GuestList guests={event.attendees} />
            </dd>
          </>
        ) : null}
        {event.description && (
          <>
            <dt>{t.common.description}</dt>
            <dd className={s.description}>{plainText(event.description)}</dd>
          </>
        )}
      </dl>
      <ConflictNote event={event} />
      {event.recurring && <SeriesNote event={event} />}
      {!editable && <p className={s.note}>{t.editor.readOnly}</p>}
      {error && <p className={s.error}>{error}</p>}
      {ask === "delete" ? (
        <ScopePrompt kind="delete" />
      ) : (
        <div className={s.actions}>
          <GoogleLink href={event.htmlLink} />
          <div className={s.spacer} />
          {/* копию можно сделать и из чужого календаря: она ляжет в свой */}
          {writable.length > 0 && (
            <Button variant="ghost" onClick={() => duplicate()} disabled={busy}>
              {t.editor.duplicate}
            </Button>
          )}
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

/** Календари для записи. Аккаунтов несколько — календари сгруппированы по ним.
 *  У существующего события в списке только календари его аккаунта: Google не переносит события между аккаунтами */
const CalendarSelect = ({
  value,
  calendars,
  onChange,
}: {
  value: string;
  calendars: Calendar[];
  onChange: (id: string) => void;
}) => {
  const accounts = [...new Set(calendars.map((c) => c.account))];
  const option = (c: Calendar) => (
    <option key={c.id} value={c.id}>
      {c.name}
    </option>
  );
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {accounts.length > 1
        ? accounts.map((a) => (
            <optgroup key={a} label={a}>
              {calendars.filter((c) => c.account === a).map(option)}
            </optgroup>
          ))
        : calendars.map(option)}
    </select>
  );
};

const TRAVEL_OPTIONS = [0, 5, 10, 15, 30, 45, 60, 90, 120];

/** Время в пути: Google Календарь такого поля не знает, храним его в скрытых полях события */
const TravelField = ({ value, onChange }: { value: number; onChange: (minutes: number) => void }) => {
  const options = TRAVEL_OPTIONS.includes(value) ? TRAVEL_OPTIONS : [...TRAVEL_OPTIONS, value].sort((a, b) => a - b);
  return (
    <Field label={t.editor.travel}>
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {options.map((m) => (
          <option key={m} value={m}>
            {m ? travelSpan(m) : t.editor.travelNone}
          </option>
        ))}
      </select>
    </Field>
  );
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Гости: email через Enter, запятую или пробел; у каждого — ответ на приглашение */
const GuestsField = ({ guests, onChange }: { guests: Attendee[]; onChange: (guests: Attendee[]) => void }) => {
  const [text, setText] = useState("");
  const [bad, setBad] = useState(false);
  const add = () => {
    const emails = text.split(/[\s,;]+/).filter(Boolean);
    if (!emails.length) return true;
    if (!emails.every((e) => EMAIL.test(e))) {
      setBad(true);
      return false;
    }
    const known = new Set(guests.map((g) => g.email.toLowerCase()));
    const fresh = emails.filter((e) => !known.has(e.toLowerCase())).map((email) => ({ email }));
    onChange([...guests, ...fresh]);
    setText("");
    return true;
  };
  return (
    <div className={s.field}>
      <span>{t.editor.guests}</span>
      {guests.length > 0 && (
        <ul className={s.guests}>
          {guests.map((g) => (
            <li key={g.email} className={s.guest}>
              <span className={s.guestName} title={g.email}>
                {g.displayName || g.email}
              </span>
              {g.organizer ? (
                <small>{t.editor.organizer}</small>
              ) : (
                g.responseStatus && <small>{t.editor.guestStatus[g.responseStatus]}</small>
              )}
              {!g.organizer && !g.self && (
                <button
                  type="button"
                  className={s.removeGuest}
                  onClick={() => onChange(guests.filter((x) => x !== g))}
                  aria-label={t.editor.removeGuest(g.email)}
                  title={t.editor.removeGuest(g.email)}
                >
                  <Close size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <input
        type="email"
        multiple
        value={text}
        placeholder={t.editor.addGuest}
        aria-label={t.editor.addGuest}
        aria-invalid={bad}
        onChange={(e) => {
          setText(e.target.value);
          setBad(false);
        }}
        onKeyDown={(e) => {
          // Enter с текстом в поле добавляет гостя, а не сохраняет форму
          if ((e.key === "Enter" || e.key === ",") && text.trim()) {
            e.preventDefault();
            add();
          }
        }}
        onBlur={() => add()}
      />
      {bad && <small className={s.error}>{t.editor.badEmail}</small>}
      {hasGuests(guests) && <small className={s.hintText}>{t.editor.invitesNote}</small>}
    </div>
  );
};

/** Гости в карточке: «Анна — придёт», организатор отмечен */
const GuestList = ({ guests }: { guests: Attendee[] }) => (
  <ul className={s.guests}>
    {guests.map((g) => (
      <li key={g.email} className={cx(s.guest, g.responseStatus === "declined" && s.declined)}>
        <span className={s.guestName} title={g.email}>
          {g.displayName || g.email}
        </span>
        <small>{g.organizer ? t.editor.organizer : g.responseStatus && t.editor.guestStatus[g.responseStatus]}</small>
      </li>
    ))}
  </ul>
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

      {!draft.allDay && (
        <>
          <Field label={t.editor.timeZone}>
            <TimeZoneSelect value={draftZone(draft)} onChange={(timeZone) => change({ timeZone })} />
          </Field>
          <LocalTimeNote draft={draft} />
          <TravelField value={draft.travelMinutes ?? 0} onChange={(travelMinutes) => change({ travelMinutes })} />
        </>
      )}

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
          <CalendarSelect
            value={draft.calendarId}
            calendars={isNew ? writable : writable.filter((c) => c.account === calendar?.account)}
            onChange={(calendarId) => change({ calendarId })}
          />
        )}
      </Field>

      <Field label={t.common.location}>
        <input value={draft.location} onChange={(e) => change({ location: e.target.value })} />
      </Field>

      {draft.addMeet !== undefined && (
        <label className={s.check}>
          <input type="checkbox" checked={draft.addMeet} onChange={(e) => change({ addMeet: e.target.checked })} />
          {t.editor.addMeet}
        </label>
      )}

      {draft.guests && <GuestsField guests={draft.guests} onChange={(guests) => change({ guests })} />}

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
