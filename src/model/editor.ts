import { createEffect, createEvent, createStore, sample } from "effector";
import { logError } from "../shared/lib/log";
import { t } from "../shared/i18n";
import {
  deleteOccurrence,
  draftInstant,
  draftZone,
  loadRecurrence,
  recurrenceEdited,
  respondToEvent,
  saveEvent,
  withResponse,
  type ResponseStatus,
} from "../shared/api/calendar";
import { wallClock } from "../shared/lib/tz";
import type { AppError, CalendarEvent, EventDraft, Scope } from "../shared/api/types";
import {
  addDays,
  addMinutes,
  combineDateTime,
  daysBetween,
  fromDateKey,
  localTimeZone,
  toDateKey,
  toTimeKey,
} from "../shared/lib/date";
import { buildRecurrence, followStart, parseRecurrence } from "../shared/lib/rrule";
import { broadcast } from "../shared/api/bus";
import { sessionLost } from "./auth";
import { $writableCalendars } from "./calendars";
import { actionFailed, eventShifted, reloadRequested } from "./events";

export const eventOpened = createEvent<CalendarEvent>();
export const slotClicked = createEvent<{ start: Date; allDay?: boolean }>();
export const createClicked = createEvent();
export const draftChanged = createEvent<Partial<EventDraft>>();
export const editorClosed = createEvent();
export const editClicked = createEvent();
/** open the form with a ready draft (from quick add) */
export const draftOpened = createEvent<EventDraft>();
export const editCancelled = createEvent();
export const saveClicked = createEvent();
export const deleteClicked = createEvent();
/** answer to the question "only this event or this and following" */
export const scopeChosen = createEvent<Scope>();
export const scopeCancelled = createEvent();
/** response to an invitation in the card of someone else's meeting */
export const rsvpClicked = createEvent<ResponseStatus>();
export const rsvpFx = createEffect<{ event: CalendarEvent; status: ResponseStatus }, void, AppError>(({ event, status }) =>
  respondToEvent(event, status),
);
/** "Duplicate" in the event card */
export const duplicateClicked = createEvent();
/** Delete on a selected event: the card opens with the "Press again to delete" button */
export const deleteArmed = createEvent();

type Change = { draft: EventDraft; scope: Scope };

export const saveFx = createEffect<Change, void, AppError>(({ draft, scope }) => saveEvent(draft, scope));

/** dragging in the grid: save the new time right away, without the form; for a series — only this occurrence */
export const eventMoved = createEvent<{ event: CalendarEvent; start: Date; end: Date }>();
export const moveFx = createEffect<{ event: CalendarEvent; start: Date; end: Date }, void, AppError>(
  ({ event, start, end }) => saveEvent(fromEvent({ ...event, start, end })),
);
export const deleteFx = createEffect<Change, void, AppError>(({ draft, scope }) => deleteOccurrence(draft, scope));
/** Deletion chosen: the card closes, the event disappears from the screen, and goes to Google
 *  when the "Undo" bar disappears (model/undo.ts) */
export const deleteRequested = createEvent<Change & { event: CalendarEvent }>();

/** a single field without the form (Ctrl+K menu: Google Meet, color); for a series — only this occurrence */
export const eventPatched = createEvent<{ event: CalendarEvent; patch: Partial<EventDraft> }>();
export const patchFx = createEffect<EventDraft, void, AppError>((draft) => saveEvent(draft));

/** the series rule is stored on the master event: load it when an occurrence is opened */
export const loadSeriesFx = createEffect<{ calendarId: string; id: string }, string[], AppError>(({ calendarId, id }) =>
  loadRecurrence(calendarId, id),
);

/** rule of the currently open series: lines — null while loading and on error */
export const $series = createStore<{ id: string; lines: string[] | null; failed: boolean } | null>(null)
  .on(loadSeriesFx, (_, { id }) => ({ id, lines: null, failed: false }))
  .on(loadSeriesFx.done, (state, { params, result }) =>
    state?.id === params.id ? { ...state, lines: result } : state,
  )
  .on(loadSeriesFx.fail, (state, { params }) => (state?.id === params.id ? { ...state, failed: true } : state));

/** Draft from an event. Time in the form follows the event's time zone clock, so that on save
 *  and drag the time zone from Google isn't replaced with the system one */
export const fromEvent = (e: CalendarEvent, series?: string[] | null): EventDraft => {
  const zone = e.timeZone ?? localTimeZone();
  // all-day event — just dates, it needs no time zone
  const start = e.allDay ? e.start : wallClock(e.start, zone);
  const end = e.allDay ? addDays(e.end, -1) : wallClock(e.end, zone);
  return {
    id: e.id,
    originalCalendarId: e.calendarId,
    calendarId: e.calendarId,
    title: e.title === t.common.untitled ? "" : e.title,
    allDay: e.allDay,
    startDate: toDateKey(start),
    startTime: toTimeKey(start),
    // in the form the last day of an all-day event is shown inclusive
    endDate: toDateKey(end),
    endTime: toTimeKey(end),
    timeZone: zone,
    ...(e.allDay ? {} : { originalTimes: { zone, start: e.start, end: e.end } }),
    ...(e.endTimeZone ? { endTimeZone: e.endTimeZone } : {}),
    location: e.location ?? "",
    description: e.description ?? "",
    recurrence: e.recurringEventId ? (series ?? []) : [],
    originalRecurrence: e.recurringEventId ? (series ?? undefined) : [],
    recurringEventId: e.recurringEventId,
    originalStart: e.originalStart,
    htmlLink: e.htmlLink,
    // write the field to Google only if travel time exists or was changed
    ...(e.travelMinutes ? { travelMinutes: e.travelMinutes } : {}),
    // only the organizer changes the guest list; for someone else's meeting leave it alone
    ...(e.organizerSelf !== false ? { guests: e.attendees ?? [] } : {}),
    // attachments of someone else's meeting are changed by its organizer
    ...(e.organizerSelf !== false ? { attachments: e.attachments ?? [] } : {}),
    colorId: e.colorId ?? "",
    // a video meeting can be added only if there isn't one yet
    ...(e.meeting ? {} : { addMeet: false }),
  };
};

/** Event copy is a new event with the same fields. A series occurrence is copied as one event,
 *  the old video meeting and guest responses are not carried over: the account itself becomes the organizer of the copy.
 *  An event from a read-only calendar is copied into the first writable calendar */
export const duplicateDraft = (e: CalendarEvent, writable: string[]): EventDraft => {
  const draft: EventDraft = { ...fromEvent(e) };
  delete draft.id;
  delete draft.originalCalendarId;
  delete draft.recurringEventId;
  delete draft.originalStart;
  delete draft.originalRecurrence;
  delete draft.htmlLink;
  return {
    ...draft,
    calendarId: writable.includes(e.calendarId) ? e.calendarId : (writable[0] ?? e.calendarId),
    recurrence: [],
    guests: (e.attendees ?? [])
      .filter((a) => !a.self)
      .map((a) => ({ email: a.email, ...(a.displayName ? { displayName: a.displayName } : {}) })),
    addMeet: false,
    // the copy has the same attachments; they must be sent along with the new event
    attachmentsChanged: Boolean(e.attachments?.length),
    attachments: e.attachments ?? [],
  };
};

const newDraft = (calendarId: string, start: Date, allDay: boolean): EventDraft => {
  const end = addMinutes(start, 60);
  return {
    calendarId,
    title: "",
    allDay,
    startDate: toDateKey(start),
    startTime: toTimeKey(start),
    endDate: toDateKey(allDay ? start : end),
    endTime: toTimeKey(end),
    timeZone: localTimeZone(),
    location: "",
    description: "",
    recurrence: [],
    guests: [],
    addMeet: false,
    attachments: [],
  };
};

/** the nearest half hour from now */
const nextHalfHour = (): Date => {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60);
  return d;
};

export const draftStart = (d: EventDraft): Date =>
  d.allDay ? fromDateKey(d.startDate) : combineDateTime(d.startDate, d.startTime);

/** A regular event's rule follows its start: "every Wednesday" → "every Thursday".
 *  A series occurrence's rule is left alone: moving one occurrence doesn't change it */
const followRule = (prev: EventDraft, next: EventDraft): EventDraft => {
  if (next.recurringEventId || !next.recurrence.length) return next;
  const { rule, extra } = parseRecurrence(next.recurrence, draftStart(prev), draftZone(prev));
  if (!rule) return next;
  const start = draftStart(next);
  return {
    ...next,
    recurrence: buildRecurrence(followStart(rule, draftStart(prev), start), extra, start, next.allDay, draftZone(next)),
  };
};

/** If the start is moved past the end, the end follows, keeping the duration.
 *  Changing the time zone keeps the clock in the form as is (as in Google), and the separate end time zone is dropped */
export const applyChange = (draft: EventDraft, patch: Partial<EventDraft>): EventDraft => {
  const next = { ...draft, ...patch, ...("attachments" in patch ? { attachmentsChanged: true } : {}) };
  if ("timeZone" in patch && patch.timeZone !== draft.timeZone) {
    delete next.endTimeZone;
    return followRule(draft, next);
  }
  const startChanged = "startDate" in patch || "startTime" in patch;
  if (!startChanged) return "allDay" in patch ? followRule(draft, next) : next;

  if (next.allDay) {
    const span = daysBetween(fromDateKey(draft.startDate), fromDateKey(draft.endDate));
    const start = fromDateKey(next.startDate);
    return followRule(draft, { ...next, endDate: toDateKey(addDays(start, Math.max(0, span))) });
  }
  const oldStart = combineDateTime(draft.startDate, draft.startTime);
  const oldEnd = combineDateTime(draft.endDate, draft.endTime);
  const duration = Math.max(15, (oldEnd.getTime() - oldStart.getTime()) / 60_000);
  const end = addMinutes(combineDateTime(next.startDate, next.startTime), duration);
  return followRule(draft, { ...next, endDate: toDateKey(end), endTime: toTimeKey(end) });
};

export const validate = (d: EventDraft): string | null => {
  if (!d.calendarId) return t.errors.noWritableCalendar;
  const start = d.allDay ? fromDateKey(d.startDate) : draftInstant(d, "start");
  const end = d.allDay ? fromDateKey(d.endDate) : draftInstant(d, "end");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return t.errors.checkDateTime;
  if (d.allDay ? end < start : end <= start) return t.errors.endBeforeStart;
  return null;
};

/** event opened for viewing (before switching to edit) */
export const $opened = createStore<CalendarEvent | null>(null)
  .on(eventOpened, (_, e) => e)
  .reset([slotClicked, createClicked, draftOpened, editorClosed, saveFx.done, deleteRequested]);

/** viewing an existing event or the edit/create form */
export const $mode = createStore<"view" | "edit">("view")
  .on(eventOpened, () => "view")
  .on([slotClicked, createClicked, editClicked, draftOpened], () => "edit")
  .on(editCancelled, () => "view");

export const $draft = createStore<EventDraft | null>(null)
  .on(eventOpened, (_, e) => fromEvent(e))
  .on(draftOpened, (_, d) => d)
  .on(draftChanged, (d, patch) => (d ? applyChange(d, patch) : d))
  // series rule arrived: fill it in if the user hasn't started changing it yet
  .on(loadSeriesFx.done, (d, { params, result }) =>
    d && d.recurringEventId === params.id && d.originalRecurrence === undefined
      ? { ...d, recurrence: result, originalRecurrence: result }
      : d,
  )
  .reset([editorClosed, saveFx.done, deleteRequested]);

/** card opened with the Delete key: the delete button is already focused, Enter deletes */
export const $deleteArmed = createStore(false)
  .on(deleteArmed, () => true)
  .reset([eventOpened, editorClosed, editClicked, duplicateClicked, deleteRequested]);

/** copy draft: take the open event before the card closes */
const duplicated = sample({
  clock: duplicateClicked,
  source: { opened: $opened, writable: $writableCalendars },
  filter: ({ opened }) => Boolean(opened),
  fn: ({ opened, writable }) => duplicateDraft(opened as CalendarEvent, writable.map((c) => c.id)),
});
$draft.on(duplicated, (_, d) => d);

sample({
  clock: rsvpClicked,
  source: $opened,
  filter: (opened) => Boolean(opened),
  fn: (event, status) => ({ event: event as CalendarEvent, status }),
  target: rsvpFx,
});
// the card shows the new response right away, events are reloaded after
$opened.on(rsvpFx.done, (e, { params }) => (e && e.key === params.event.key ? withResponse(e, params.status) : e));
$opened.reset(duplicated);
$mode.on(duplicated, () => "edit");

sample({
  clock: eventOpened,
  filter: (e) => Boolean(e.recurringEventId),
  fn: (e) => ({ calendarId: e.calendarId, id: e.recurringEventId ?? "" }),
  target: loadSeriesFx,
});

// "Cancel" in the form of an existing event restores the original values
sample({
  clock: editCancelled,
  source: { opened: $opened, series: $series },
  filter: ({ opened }) => Boolean(opened),
  fn: ({ opened, series }) => {
    const e = opened as CalendarEvent;
    return fromEvent(e, series?.id === e.recurringEventId ? series?.lines : null);
  },
  target: $draft,
});

const $defaultCalendarId = $writableCalendars.map((list) => list[0]?.id ?? "");

sample({
  clock: slotClicked,
  source: $defaultCalendarId,
  fn: (calendarId, { start, allDay }) => newDraft(calendarId, start, Boolean(allDay)),
  target: $draft,
});

sample({
  clock: createClicked,
  source: $defaultCalendarId,
  fn: (calendarId) => newDraft(calendarId, nextHalfHour(), false),
  target: $draft,
});

/** the question of which series occurrences to apply save or delete to is open */
export const $askScope = createStore<"save" | "delete" | null>(null)
  // not via scopeChosen: the answer is still needed to pick save or delete
  .reset([saveFx, deleteRequested, scopeCancelled, eventOpened, slotClicked, createClicked, draftOpened, editClicked, editCancelled, editorClosed, duplicated]);

/** the rule in the form was changed: then editing is possible only for "this and following" */
export const $recurrenceEdited = $draft.map((d) => (d ? recurrenceEdited(d) : false));

export const $editorError = createStore<string | null>(null)
  .on([saveFx.failData, rsvpFx.failData], (_, e) => e.message)
  .reset([eventOpened, slotClicked, createClicked, draftOpened, editClicked, editCancelled, editorClosed, saveFx, deleteRequested, duplicated]);

// deletion goes to Google when the card is already closed: its error goes to the bar above the calendar
export const $busy = sample({
  source: { save: saveFx.pending, rsvp: rsvpFx.pending },
  fn: ({ save, rsvp }) => save || rsvp,
});

const $validationError = $draft.map((d) => (d ? validate(d) : null));

sample({
  clock: saveClicked,
  source: $validationError,
  filter: Boolean,
  target: $editorError,
});

const $canSave = sample({
  source: { draft: $draft, error: $validationError, busy: $busy },
  fn: ({ draft, error, busy }) => Boolean(draft) && !error && !busy,
});

// series occurrence: first ask which occurrences to apply to
sample({
  clock: saveClicked,
  source: { draft: $draft, ok: $canSave },
  filter: ({ draft, ok }) => ok && Boolean(draft?.recurringEventId),
  fn: () => "save" as const,
  target: $askScope,
});

sample({
  clock: saveClicked,
  source: { draft: $draft, ok: $canSave },
  filter: ({ draft, ok }) => ok && !draft?.recurringEventId,
  fn: ({ draft }) => ({ draft: draft as EventDraft, scope: "this" as const }),
  target: saveFx,
});

sample({
  clock: deleteClicked,
  source: { draft: $draft, busy: $busy },
  filter: ({ draft, busy }) => Boolean(draft?.id && draft.recurringEventId) && !busy,
  fn: () => "delete" as const,
  target: $askScope,
});

sample({
  clock: deleteClicked,
  source: { draft: $draft, busy: $busy, event: $opened },
  filter: ({ draft, busy, event }) => Boolean(draft?.id && event) && !draft?.recurringEventId && !busy,
  fn: ({ draft, event }) => ({ draft: draft as EventDraft, scope: "this" as const, event: event as CalendarEvent }),
  target: deleteRequested,
});

sample({
  clock: scopeChosen,
  source: { ask: $askScope, draft: $draft },
  filter: ({ ask, draft }) => ask === "save" && Boolean(draft),
  fn: ({ draft }, scope) => ({ draft: draft as EventDraft, scope }),
  target: saveFx,
});

sample({
  clock: scopeChosen,
  source: { ask: $askScope, draft: $draft, event: $opened },
  filter: ({ ask, draft, event }) => ask === "delete" && Boolean(draft && event),
  fn: ({ draft, event }, scope) => ({ draft: draft as EventDraft, scope, event: event as CalendarEvent }),
  target: deleteRequested,
});

sample({ clock: eventMoved, target: moveFx });
sample({
  clock: eventMoved,
  fn: ({ event, start, end }) => ({ key: event.key, start, end }),
  target: eventShifted,
});
// on error the event returns to its place after reloading
sample({
  clock: moveFx.failData,
  fn: (e) => t.errors.moveFailed(e.message),
  target: actionFailed,
});

sample({ clock: eventPatched, fn: ({ event, patch }) => ({ ...fromEvent(event), ...patch }), target: patchFx });
sample({ clock: patchFx.failData, fn: (e) => t.errors.changeFailed(e.message), target: actionFailed });
// on delete error the event returns to the screen after reloading
sample({ clock: deleteFx.failData, fn: (e) => t.errors.deleteFailed(e.message), target: actionFailed });
sample({ clock: [saveFx.done, deleteFx.finally, moveFx.finally, rsvpFx.done, patchFx.finally], target: reloadRequested });
patchFx.done.watch(() => broadcast("events-changed", { from: "main" }));
rsvpFx.done.watch(() => broadcast("events-changed", { from: "main" }));
moveFx.done.watch(() => broadcast("events-changed", { from: "main" }));
// UI errors during save (Rust logs Google responses) go to the log
for (const [name, fx] of [["save", saveFx], ["delete", deleteFx], ["move", moveFx]] as const) {
  fx.failData.watch((e) => e.kind === "other" && logError(`${name} event failed`, e));
}

// the widget will reload events
saveFx.done.watch(() => broadcast("events-changed", { from: "main" }));
deleteFx.done.watch(() => broadcast("events-changed", { from: "main" }));

sample({
  clock: [saveFx.failData, deleteFx.failData, moveFx.failData, loadSeriesFx.failData, rsvpFx.failData],
  filter: (e) => e.kind === "not_signed_in",
  target: sessionLost,
});
