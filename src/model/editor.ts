import { createEffect, createEvent, createStore, sample } from "effector";
import { deleteEvent, saveEvent } from "../shared/api/calendar";
import type { AppError, CalendarEvent, EventDraft } from "../shared/api/types";
import {
  addDays,
  addMinutes,
  combineDateTime,
  fromDateKey,
  toDateKey,
  toTimeKey,
} from "../shared/lib/date";
import { broadcast } from "../shared/api/bus";
import { sessionLost } from "./auth";
import { $writableCalendars } from "./calendars";
import { reloadRequested } from "./events";

export const eventOpened = createEvent<CalendarEvent>();
export const slotClicked = createEvent<{ start: Date; allDay?: boolean }>();
export const createClicked = createEvent();
export const draftChanged = createEvent<Partial<EventDraft>>();
export const editorClosed = createEvent();
export const editClicked = createEvent();
export const editCancelled = createEvent();
export const saveClicked = createEvent();
export const deleteClicked = createEvent();

export const saveFx = createEffect<EventDraft, void, AppError>(saveEvent);
export const deleteFx = createEffect<EventDraft, void, AppError>((d) =>
  deleteEvent(d.originalCalendarId ?? d.calendarId, d.id ?? ""),
);

const fromEvent = (e: CalendarEvent): EventDraft => ({
  id: e.id,
  originalCalendarId: e.calendarId,
  calendarId: e.calendarId,
  title: e.title === "(без названия)" ? "" : e.title,
  allDay: e.allDay,
  startDate: toDateKey(e.start),
  startTime: toTimeKey(e.start),
  // в форме последний день события на весь день показываем включительно
  endDate: toDateKey(e.allDay ? addDays(e.end, -1) : e.end),
  endTime: toTimeKey(e.end),
  location: e.location ?? "",
  description: e.description ?? "",
  recurring: e.recurring,
  htmlLink: e.htmlLink,
});

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
    location: "",
    description: "",
    recurring: false,
  };
};

/** ближайшие полчаса от текущего момента */
const nextHalfHour = (): Date => {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60);
  return d;
};

/** Если начало сдвинули позже конца, конец сдвигается следом с той же длительностью */
export const applyChange = (draft: EventDraft, patch: Partial<EventDraft>): EventDraft => {
  const next = { ...draft, ...patch };
  const startChanged = "startDate" in patch || "startTime" in patch;
  if (!startChanged) return next;

  if (next.allDay) {
    const span = fromDateKey(draft.endDate).getTime() - fromDateKey(draft.startDate).getTime();
    const start = fromDateKey(next.startDate);
    return { ...next, endDate: toDateKey(new Date(start.getTime() + Math.max(0, span))) };
  }
  const oldStart = combineDateTime(draft.startDate, draft.startTime);
  const oldEnd = combineDateTime(draft.endDate, draft.endTime);
  const duration = Math.max(15, (oldEnd.getTime() - oldStart.getTime()) / 60_000);
  const end = addMinutes(combineDateTime(next.startDate, next.startTime), duration);
  return { ...next, endDate: toDateKey(end), endTime: toTimeKey(end) };
};

export const validate = (d: EventDraft): string | null => {
  if (!d.calendarId) return "Нет календаря, в который можно записать событие";
  const start = d.allDay ? fromDateKey(d.startDate) : combineDateTime(d.startDate, d.startTime);
  const end = d.allDay ? fromDateKey(d.endDate) : combineDateTime(d.endDate, d.endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "Проверь дату и время";
  if (d.allDay ? end < start : end <= start) return "Конец события раньше начала";
  return null;
};

/** событие, открытое для просмотра (до перехода в правку) */
export const $opened = createStore<CalendarEvent | null>(null)
  .on(eventOpened, (_, e) => e)
  .reset([slotClicked, createClicked, editorClosed, saveFx.done, deleteFx.done]);

/** просмотр существующего события или форма правки и создания */
export const $mode = createStore<"view" | "edit">("view")
  .on(eventOpened, () => "view")
  .on([slotClicked, createClicked, editClicked], () => "edit")
  .on(editCancelled, () => "view");

export const $draft = createStore<EventDraft | null>(null)
  .on(eventOpened, (_, e) => fromEvent(e))
  .on(draftChanged, (d, patch) => (d ? applyChange(d, patch) : d))
  .reset([editorClosed, saveFx.done, deleteFx.done]);

// «Отмена» в форме существующего события возвращает исходные значения
sample({
  clock: editCancelled,
  source: $opened,
  filter: Boolean,
  fn: (e) => fromEvent(e as CalendarEvent),
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

export const $editorError = createStore<string | null>(null)
  .on([saveFx.failData, deleteFx.failData], (_, e) => e.message)
  .reset([eventOpened, slotClicked, createClicked, editClicked, editCancelled, editorClosed, saveFx, deleteFx]);

export const $busy = sample({
  source: { save: saveFx.pending, del: deleteFx.pending },
  fn: ({ save, del }) => save || del,
});

const $validationError = $draft.map((d) => (d ? validate(d) : null));

sample({
  clock: saveClicked,
  source: $validationError,
  filter: Boolean,
  target: $editorError,
});

sample({
  clock: saveClicked,
  source: { draft: $draft, error: $validationError, busy: $busy },
  filter: ({ draft, error, busy }) => Boolean(draft) && !error && !busy,
  fn: ({ draft }) => draft as EventDraft,
  target: saveFx,
});

sample({
  clock: deleteClicked,
  source: { draft: $draft, busy: $busy },
  filter: ({ draft, busy }) => Boolean(draft?.id) && !busy,
  fn: ({ draft }) => draft as EventDraft,
  target: deleteFx,
});

sample({ clock: [saveFx.done, deleteFx.done], target: reloadRequested });

// виджет перечитает события
saveFx.done.watch(() => broadcast("events-changed"));
deleteFx.done.watch(() => broadcast("events-changed"));

sample({
  clock: [saveFx.failData, deleteFx.failData],
  filter: (e) => e.kind === "not_signed_in",
  target: sessionLost,
});
