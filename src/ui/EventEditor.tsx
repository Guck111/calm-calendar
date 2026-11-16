import { useUnit } from "effector-react";
import { t } from "../shared/i18n";
import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { $accounts } from "../model/auth";
import { $calendarById, $writableCalendars } from "../model/calendars";
import { $conflicts } from "../model/events";
import {
  $askScope,
  $busy,
  $deleteArmed,
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
  rsvpClicked,
  editClicked,
  editorClosed,
  saveClicked,
  scopeCancelled,
  sameSeries,
  scopeChosen,
} from "../model/editor";
import { openExternal } from "../shared/api/open";
import { placeLink } from "../shared/lib/maps";
import { draftZone, hasGuests, myResponse, type ResponseStatus } from "../shared/api/calendar";
import type { Attachment, Attendee, Calendar, CalendarEvent, EventDraft } from "../shared/api/types";
import { addDays, formatSpan as travelSpan, formatFullDate, formatShortDate, formatTime, isSameDay, localTimeZone } from "../shared/lib/date";
import { fromZoned, wallClock, zoneLabel } from "../shared/lib/tz";
import { TimeZoneSelect } from "./TimeZoneSelect";
import { describeRule, parseRecurrence } from "../shared/lib/rrule";
import { RepeatField } from "./RepeatField";
import { Button, cx } from "./Button";
import { ChevronRight, Close, External, MapPin, Paperclip, Video, Warning } from "./icons";
import { MAX_ATTACHMENTS, parseDriveLink } from "../shared/lib/attachments";
import { COLOR_IDS, EVENT_COLORS, eventColor } from "../shared/lib/colors";
import s from "./EventEditor.module.css";
import { plainText } from "../shared/lib/plain-text";

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


type DeleteProps = {
  busy: boolean;
  onConfirm: () => void;
  /** opened with the Delete key: the button is focused, Enter deletes */
  armed?: boolean;
};

/** Deletes with one press: instead of "Really delete?" there is "Undo" after deletion (model/undo.ts).
 *  For a series occurrence, first the question "only this or this and following" */
const DeleteButton = ({ busy, onConfirm, armed = false }: DeleteProps) => (
  <Button danger variant="ghost" disabled={busy} autoFocus={armed} onClick={onConfirm}>
    {t.editor.delete}
  </Button>
);

const GoogleLink = ({ href }: { href?: string }) =>
  href ? (
    <Button variant="ghost" onClick={() => void openExternal(href)} title={t.editor.openInGoogle}>
      <External /> {t.editor.inGoogle}
    </Button>
  ) : null;

/** Question before saving or deleting a series occurrence */
const ScopePrompt = ({ kind }: { kind: "save" | "delete" }) => {
  const [busy, edited, choose, cancel] = useUnit([$busy, $recurrenceEdited, scopeChosen, scopeCancelled]);
  // a new rule can only start from this occurrence
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
          // for deletion both buttons are red, without fill: red text on a blue background is unreadable
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

/** "Every week, on Mon and Wed" for a series occurrence; while the rule is loading — just "recurring" */
const SeriesNote = ({ event }: { event: CalendarEvent }) => {
  const series = useUnit($series);
  const own = series && event.recurringEventId && sameSeries(series, { calendarId: event.calendarId, id: event.recurringEventId });
  const lines = own ? series.lines : null;
  // weekdays in the rule follow the event's time zone clock
  const zone = event.allDay ? undefined : event.timeZone;
  const start = zone ? wallClock(event.start, zone) : event.start;
  const text = lines?.length ? describeRule(parseRecurrence(lines, start, zone).rule, start) : t.editor.recurring;
  return <p className={s.note}>{text}</p>;
};

/** meeting location: on click — Google Maps in the browser (or the link itself, if the field is a link) */
const PlaceLink = ({ location }: { location: string }) => {
  const href = placeLink(location);
  if (!href) return <>{location}</>;
  return (
    <button type="button" className={s.file} onClick={() => void openExternal(href)} title={t.editor.openMap}>
      <MapPin /> {location}
    </button>
  );
};

/** "Overlaps with: Call 14:00–15:00 (work@company.com)" — an event from another account at the same time */
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

/** "9:00–10:00 (GMT−05:00) Eastern Time — New York" for an event in another time zone */
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

/** "In your time: Thu, Nov 5, 0:30–1:30" in the form, if the event time zone isn't the system one */
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

const ANSWERS = ["accepted", "declined", "tentative"] as const;

/** "Going? Yes · No · Maybe" for someone else's meeting this account was invited to */
const RsvpButtons = ({
  response,
  busy,
  onAnswer,
}: {
  response: ResponseStatus;
  busy: boolean;
  onAnswer: (status: ResponseStatus) => void;
}) => {
  const label = { accepted: t.editor.rsvpYes, declined: t.editor.rsvpNo, tentative: t.editor.rsvpMaybe };
  return (
    <div className={s.rsvp} role="group" aria-label={t.editor.rsvpQuestion}>
      <span className={s.rsvpQuestion}>{t.editor.rsvpQuestion}</span>
      {ANSWERS.map((status) => (
        <button
          key={status}
          type="button"
          aria-pressed={response === status}
          className={cx(s.rsvpOption, response === status && s.rsvpOn)}
          disabled={busy}
          onClick={() => response !== status && onAnswer(status)}
        >
          {label[status]}
        </button>
      ))}
    </div>
  );
};

/** Event card: view only, edit by button */
const EventDetails = ({ event, editable }: { event: CalendarEvent; editable: boolean }) => {
  const response = myResponse(event);
  const [byId, accounts, busy, error, ask, close, edit, remove, duplicate, writable, rsvp, armed] = useUnit([
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
    rsvpClicked,
    $deleteArmed,
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
          autoFocus={!armed}
        >
          <Video /> {t.meeting.join}
          <span className={s.provider}>{event.meeting.provider}</span>
        </Button>
      )}
      {response && <RsvpButtons response={response} busy={busy} onAnswer={rsvp} />}
      <dl className={s.details}>
        <dt>{t.common.calendar}</dt>
        <dd>
          <i className={s.swatch} />
          {calendar?.name ?? event.calendarId}
          {accounts.length > 1 && !calendar?.feed && <span className={s.accountName}>{event.account}</span>}
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
            <dd>
              <PlaceLink location={event.location} />
            </dd>
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
        {event.attachments?.length ? (
          <>
            <dt>{t.editor.attachments}</dt>
            <dd>
              <ul className={s.files}>
                {event.attachments.map((a) => (
                  <li key={a.fileUrl}>
                    <button type="button" className={s.file} onClick={() => void openExternal(a.fileUrl)} title={a.fileUrl}>
                      <Paperclip /> {a.title}
                    </button>
                  </li>
                ))}
              </ul>
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
          {/* a copy can be made from someone else's calendar too: it goes into our own */}
          {writable.length > 0 && (
            <Button variant="ghost" onClick={() => duplicate()} disabled={busy}>
              {t.editor.duplicate}
            </Button>
          )}
          {editable && (
            <DeleteButton busy={busy} onConfirm={() => remove()} armed={armed} />
          )}
          {editable && (
            <Button
              variant={event.meeting ? "default" : "primary"}
              onClick={() => edit()}
              autoFocus={!event.meeting && !armed}
            >
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

/** Writable calendars. With several accounts the calendars are grouped by account.
 *  For an existing event the list has only its account's calendars: Google doesn't move events between accounts */
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

/** Event color: calendar color or one of 11 Google colors */
const ColorField = ({
  value,
  calendarColor,
  onChange,
}: {
  value: string;
  calendarColor: string;
  onChange: (colorId: string) => void;
}) => {
  const names = t.editor.colorNames as Record<string, string>;
  return (
    <div className={s.field}>
      <span>{t.editor.color}</span>
      <div className={s.colors} role="radiogroup" aria-label={t.editor.color}>
        {["", ...COLOR_IDS].map((id) => {
          const name = id ? names[id] : t.editor.calendarColor;
          return (
            <button
              key={id || "calendar"}
              type="button"
              role="radio"
              aria-checked={value === id}
              aria-label={name}
              title={name}
              className={cx(s.color, !id && s.calendarColor, value === id && s.colorOn)}
              style={{ "--swatch": id ? EVENT_COLORS[id] : calendarColor } as CSSProperties}
              onClick={() => onChange(id)}
            />
          );
        })}
      </div>
    </div>
  );
};

const TRAVEL_OPTIONS = [0, 5, 10, 15, 30, 45, 60, 90, 120];

/** Travel time: Google Calendar has no such field, we store it in the event's hidden fields */
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

/** Guests: email via Enter, comma or space; each one shows their invitation response */
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
          // Enter with text in the field adds a guest instead of saving the form
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

/** Attachments in the form: Google Drive files; a new one by link (Enter or leaving the field) */
const AttachmentsField = ({ files, onChange }: { files: Attachment[]; onChange: (files: Attachment[]) => void }) => {
  const [text, setText] = useState("");
  const [bad, setBad] = useState(false);
  const add = () => {
    if (!text.trim()) return;
    const file = parseDriveLink(text);
    if (!file) {
      setBad(true);
      return;
    }
    if (!files.some((f) => f.fileUrl === file.fileUrl)) onChange([...files, file]);
    setText("");
  };
  return (
    <div className={s.field}>
      <span>{t.editor.attachments}</span>
      {files.length > 0 && (
        <ul className={s.files}>
          {files.map((f) => (
            <li key={f.fileUrl} className={s.guest}>
              <span className={s.guestName} title={f.fileUrl}>
                <Paperclip /> {f.title}
              </span>
              <button
                type="button"
                className={s.removeGuest}
                onClick={() => onChange(files.filter((x) => x !== f))}
                aria-label={t.editor.removeAttachment(f.title)}
                title={t.editor.removeAttachment(f.title)}
              >
                <Close size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {files.length < MAX_ATTACHMENTS && (
        <input
          type="url"
          value={text}
          placeholder={t.editor.addAttachment}
          aria-label={t.editor.addAttachment}
          aria-invalid={bad}
          onChange={(e) => {
            setText(e.target.value);
            setBad(false);
          }}
          onKeyDown={(e) => {
            // Enter with a link in the field attaches the file instead of saving the form
            if (e.key === "Enter" && text.trim()) {
              e.preventDefault();
              add();
            }
          }}
          onBlur={() => add()}
        />
      )}
      {bad && <small className={s.error}>{t.editor.badAttachment}</small>}
    </div>
  );
};

/** Guests in the card: "Anna — going", the organizer is marked */
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

/** The event has one of the rare fields filled — "More" is open right away so the value isn't hidden */
export const usesMore = (d: EventDraft): boolean =>
  (!d.allDay && (draftZone(d) !== localTimeZone() || Boolean(d.endTimeZone) || Boolean(d.travelMinutes))) ||
  Boolean(d.colorId) ||
  Boolean(d.attachments?.length);

/** Create and edit form. Frequent fields on top, description (notes) right after location; time zone, travel time,
 *  color and attachments — under "More". The bottom buttons are always visible, even in a short window */
const EventForm = () => {
  // "More" was expanded or collapsed manually: remember it for this event while the form is open
  const [toggled, setToggled] = useState<{ key: string; open: boolean } | null>(null);
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
  // Google doesn't allow moving a single occurrence to another calendar
  const calendarLocked = !isNew && Boolean(draft.recurringEventId);
  // the series rule is still loading; if it didn't load, the field isn't shown: editing one occurrence works without it
  const seriesFailed = Boolean(
    series?.failed &&
      draft.recurringEventId &&
      sameSeries(series, { calendarId: draft.originalCalendarId ?? draft.calendarId, id: draft.recurringEventId }),
  );
  const seriesLoading = Boolean(draft.recurringEventId) && draft.originalRecurrence === undefined && !seriesFailed;
  const formKey = draft.id ?? "new";
  const more = toggled?.key === formKey ? toggled.open : usesMore(draft);
  const moreList = [
    ...(draft.allDay ? [] : [t.editor.timeZone, t.editor.travel]),
    t.editor.color,
    ...(draft.attachments ? [t.editor.attachments] : []),
  ].join(", ");

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
          onChange={(e) => change({ startDate: e.target.value })}
          aria-label={t.editor.startDate}
        />
        {!draft.allDay && (
          <input
            type="time"
            value={draft.startTime}
            step={300}
            onChange={(e) => change({ startTime: e.target.value })}
            aria-label={t.editor.startTime}
          />
        )}
        <span className={s.timeLabel}>{t.editor.end}</span>
        <input
          type="date"
          value={draft.endDate}
          onChange={(e) => change({ endDate: e.target.value })}
          aria-label={t.editor.endDate}
        />
        {!draft.allDay && (
          <input
            type="time"
            value={draft.endTime}
            step={300}
            onChange={(e) => change({ endTime: e.target.value })}
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

      <Field label={t.common.description}>
        <textarea
          rows={3}
          value={draft.description}
          placeholder={t.editor.descriptionHint}
          onChange={(e) => change({ description: e.target.value })}
        />
      </Field>

      {draft.addMeet !== undefined && (
        <label className={s.check}>
          <input type="checkbox" checked={draft.addMeet} onChange={(e) => change({ addMeet: e.target.checked })} />
          {t.editor.addMeet}
        </label>
      )}

      {draft.guests && <GuestsField guests={draft.guests} onChange={(guests) => change({ guests })} />}

      <button
        type="button"
        className={s.more}
        aria-expanded={more}
        aria-controls="event-more"
        onClick={() => setToggled({ key: formKey, open: !more })}
      >
        <span className={cx(s.moreArrow, more && s.moreOpen)} aria-hidden>
          <ChevronRight size={14} />
        </span>
        <span>{t.editor.more}</span>
        {!more && <span className={s.moreList}>{moreList}</span>}
      </button>

      {more && (
        <div id="event-more" className={s.moreFields}>
          {!draft.allDay && (
            <>
              <Field label={t.editor.timeZone}>
                <TimeZoneSelect value={draftZone(draft)} onChange={(timeZone) => change({ timeZone })} />
              </Field>
              <LocalTimeNote draft={draft} />
              <TravelField value={draft.travelMinutes ?? 0} onChange={(travelMinutes) => change({ travelMinutes })} />
            </>
          )}
          <ColorField
            value={draft.colorId ?? ""}
            calendarColor={eventColor(undefined, byId.get(draft.calendarId))}
            onChange={(colorId) => change({ colorId })}
          />
          {draft.attachments && (
            <AttachmentsField files={draft.attachments} onChange={(attachments) => change({ attachments })} />
          )}
        </div>
      )}

      {/* pinned to the bottom of the form window: "Save" is visible no matter how many fields are open */}
      <div className={s.footer}>
        {error && <p className={s.error}>{error}</p>}
        {ask ? (
          <ScopePrompt kind={ask} />
        ) : (
          <div className={s.actions}>
            {!isNew && <DeleteButton busy={busy} onConfirm={() => remove()} />}
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
      </div>
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

  // the listener depends on whether the form is open, not on the draft: typing doesn't re-subscribe it
  const open = Boolean(draft);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // the occurrences question closes first
      if (ask) return cancelScope();
      // from editing an existing event Esc returns to the view
      if (mode === "edit" && opened) cancel();
      else close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, mode, opened, ask, close, cancel, cancelScope]);

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
        style={{ "--c": eventColor(mode === "view" && opened ? opened : draft, calendar) } as CSSProperties}
      >
        {mode === "view" && opened ? <EventDetails event={opened} editable={editable} /> : <EventForm />}
      </div>
    </div>
  );
};
