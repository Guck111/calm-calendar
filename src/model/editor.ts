import { createEffect, createEvent, createStore, sample } from "effector";
import { logError } from "../shared/lib/log";
import { t } from "../shared/i18n";
import {
  deleteOccurrence,
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
/** открыть форму с готовым черновиком (из быстрого создания) */
export const draftOpened = createEvent<EventDraft>();
export const editCancelled = createEvent();
export const saveClicked = createEvent();
export const deleteClicked = createEvent();
/** ответ на вопрос «только это событие или это и следующие» */
export const scopeChosen = createEvent<Scope>();
export const scopeCancelled = createEvent();
/** ответ на приглашение в карточке чужой встречи */
export const rsvpClicked = createEvent<ResponseStatus>();
export const rsvpFx = createEffect<{ event: CalendarEvent; status: ResponseStatus }, void, AppError>(({ event, status }) =>
  respondToEvent(event, status),
);
/** «Создать копию» в карточке события */
export const duplicateClicked = createEvent();

type Change = { draft: EventDraft; scope: Scope };

export const saveFx = createEffect<Change, void, AppError>(({ draft, scope }) => saveEvent(draft, scope));

/** перетаскивание в сетке: новое время сохраняем сразу, без формы; у серии — только это повторение */
export const eventMoved = createEvent<{ event: CalendarEvent; start: Date; end: Date }>();
export const moveFx = createEffect<{ event: CalendarEvent; start: Date; end: Date }, void, AppError>(
  ({ event, start, end }) => saveEvent(fromEvent({ ...event, start, end })),
);
export const deleteFx = createEffect<Change, void, AppError>(({ draft, scope }) => deleteOccurrence(draft, scope));

/** правило серии хранится у главного события: загружаем, когда открыли повторение */
export const loadSeriesFx = createEffect<{ calendarId: string; id: string }, string[], AppError>(({ calendarId, id }) =>
  loadRecurrence(calendarId, id),
);

/** правило серии, открытой сейчас: lines — null, пока грузится, и при ошибке */
export const $series = createStore<{ id: string; lines: string[] | null; failed: boolean } | null>(null)
  .on(loadSeriesFx, (_, { id }) => ({ id, lines: null, failed: false }))
  .on(loadSeriesFx.done, (state, { params, result }) =>
    state?.id === params.id ? { ...state, lines: result } : state,
  )
  .on(loadSeriesFx.fail, (state, { params }) => (state?.id === params.id ? { ...state, failed: true } : state));

/** Черновик из события. Время в форме — по часам пояса события, чтобы при сохранении
 *  и перетаскивании пояс из Google не менялся на системный */
export const fromEvent = (e: CalendarEvent, series?: string[] | null): EventDraft => {
  const zone = e.timeZone ?? localTimeZone();
  // событие на весь день — просто даты, пояс им не нужен
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
    // в форме последний день события на весь день показываем включительно
    endDate: toDateKey(end),
    endTime: toTimeKey(end),
    timeZone: zone,
    ...(e.endTimeZone ? { endTimeZone: e.endTimeZone } : {}),
    location: e.location ?? "",
    description: e.description ?? "",
    recurrence: e.recurringEventId ? (series ?? []) : [],
    originalRecurrence: e.recurringEventId ? (series ?? undefined) : [],
    recurringEventId: e.recurringEventId,
    originalStart: e.originalStart,
    htmlLink: e.htmlLink,
    // поле в Google пишем, только если время в пути есть или его меняли
    ...(e.travelMinutes ? { travelMinutes: e.travelMinutes } : {}),
    // список гостей меняет только организатор; у чужой встречи его не трогаем
    ...(e.organizerSelf !== false ? { guests: e.attendees ?? [] } : {}),
    // вложения чужой встречи меняет её организатор
    ...(e.organizerSelf !== false ? { attachments: e.attachments ?? [] } : {}),
    colorId: e.colorId ?? "",
    // видеовстречу можно добавить, только если её ещё нет
    ...(e.meeting ? {} : { addMeet: false }),
  };
};

/** Копия события — новое событие с теми же полями. Повторение серии копируется одним событием,
 *  старая видеовстреча и ответы гостей не переносятся: сам аккаунт станет организатором копии.
 *  Событие из календаря только для чтения копируется в первый календарь, куда можно писать */
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
    // у копии вложения те же, их надо отправить вместе с новым событием
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

/** ближайшие полчаса от текущего момента */
const nextHalfHour = (): Date => {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60);
  return d;
};

export const draftStart = (d: EventDraft): Date =>
  d.allDay ? fromDateKey(d.startDate) : combineDateTime(d.startDate, d.startTime);

/** Правило обычного события следует за началом: «каждую среду» → «каждый четверг».
 *  У повторения серии правило не трогаем: перенос одного повторения его не меняет */
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

/** Если начало сдвинули позже конца, конец сдвигается следом с той же длительностью.
 *  Смена пояса оставляет часы в форме как есть (как в Google), а свой пояс конца забывается */
export const applyChange = (draft: EventDraft, patch: Partial<EventDraft>): EventDraft => {
  const next = { ...draft, ...patch, ...("attachments" in patch ? { attachmentsChanged: true } : {}) };
  if ("timeZone" in patch && patch.timeZone !== draft.timeZone) {
    delete next.endTimeZone;
    return followRule(draft, next);
  }
  const startChanged = "startDate" in patch || "startTime" in patch;
  if (!startChanged) return "allDay" in patch ? followRule(draft, next) : next;

  if (next.allDay) {
    const span = fromDateKey(draft.endDate).getTime() - fromDateKey(draft.startDate).getTime();
    const start = fromDateKey(next.startDate);
    return followRule(draft, { ...next, endDate: toDateKey(new Date(start.getTime() + Math.max(0, span))) });
  }
  const oldStart = combineDateTime(draft.startDate, draft.startTime);
  const oldEnd = combineDateTime(draft.endDate, draft.endTime);
  const duration = Math.max(15, (oldEnd.getTime() - oldStart.getTime()) / 60_000);
  const end = addMinutes(combineDateTime(next.startDate, next.startTime), duration);
  return followRule(draft, { ...next, endDate: toDateKey(end), endTime: toTimeKey(end) });
};

export const validate = (d: EventDraft): string | null => {
  if (!d.calendarId) return t.errors.noWritableCalendar;
  const start = d.allDay ? fromDateKey(d.startDate) : combineDateTime(d.startDate, d.startTime);
  const end = d.allDay ? fromDateKey(d.endDate) : combineDateTime(d.endDate, d.endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return t.errors.checkDateTime;
  if (d.allDay ? end < start : end <= start) return t.errors.endBeforeStart;
  return null;
};

/** событие, открытое для просмотра (до перехода в правку) */
export const $opened = createStore<CalendarEvent | null>(null)
  .on(eventOpened, (_, e) => e)
  .reset([slotClicked, createClicked, draftOpened, editorClosed, saveFx.done, deleteFx.done]);

/** просмотр существующего события или форма правки и создания */
export const $mode = createStore<"view" | "edit">("view")
  .on(eventOpened, () => "view")
  .on([slotClicked, createClicked, editClicked, draftOpened], () => "edit")
  .on(editCancelled, () => "view");

export const $draft = createStore<EventDraft | null>(null)
  .on(eventOpened, (_, e) => fromEvent(e))
  .on(draftOpened, (_, d) => d)
  .on(draftChanged, (d, patch) => (d ? applyChange(d, patch) : d))
  // правило серии пришло: подставляем, если пользователь ещё не начал его менять
  .on(loadSeriesFx.done, (d, { params, result }) =>
    d && d.recurringEventId === params.id && d.originalRecurrence === undefined
      ? { ...d, recurrence: result, originalRecurrence: result }
      : d,
  )
  .reset([editorClosed, saveFx.done, deleteFx.done]);

/** черновик копии: открытое событие берём до того, как карточка закроется */
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
// карточка сразу показывает новый ответ, события перечитываются следом
$opened.on(rsvpFx.done, (e, { params }) => (e && e.key === params.event.key ? withResponse(e, params.status) : e));
$opened.reset(duplicated);
$mode.on(duplicated, () => "edit");

sample({
  clock: eventOpened,
  filter: (e) => Boolean(e.recurringEventId),
  fn: (e) => ({ calendarId: e.calendarId, id: e.recurringEventId ?? "" }),
  target: loadSeriesFx,
});

// «Отмена» в форме существующего события возвращает исходные значения
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

/** открыт вопрос, к каким повторениям серии применить сохранение или удаление */
export const $askScope = createStore<"save" | "delete" | null>(null)
  // не по scopeChosen: ответ ещё нужен, чтобы выбрать сохранение или удаление
  .reset([saveFx, deleteFx, scopeCancelled, eventOpened, slotClicked, createClicked, draftOpened, editClicked, editCancelled, editorClosed, duplicated]);

/** правило в форме поменяли: тогда правка возможна только для «это и следующие» */
export const $recurrenceEdited = $draft.map((d) => (d ? recurrenceEdited(d) : false));

export const $editorError = createStore<string | null>(null)
  .on([saveFx.failData, deleteFx.failData, rsvpFx.failData], (_, e) => e.message)
  .reset([eventOpened, slotClicked, createClicked, draftOpened, editClicked, editCancelled, editorClosed, saveFx, deleteFx, duplicated]);

export const $busy = sample({
  source: { save: saveFx.pending, del: deleteFx.pending, rsvp: rsvpFx.pending },
  fn: ({ save, del, rsvp }) => save || del || rsvp,
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

// повторение серии: сначала спросить, к каким повторениям применить
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
  source: { draft: $draft, busy: $busy },
  filter: ({ draft, busy }) => Boolean(draft?.id) && !draft?.recurringEventId && !busy,
  fn: ({ draft }) => ({ draft: draft as EventDraft, scope: "this" as const }),
  target: deleteFx,
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
  source: { ask: $askScope, draft: $draft },
  filter: ({ ask, draft }) => ask === "delete" && Boolean(draft),
  fn: ({ draft }, scope) => ({ draft: draft as EventDraft, scope }),
  target: deleteFx,
});

sample({ clock: eventMoved, target: moveFx });
sample({
  clock: eventMoved,
  fn: ({ event, start, end }) => ({ key: event.key, start, end }),
  target: eventShifted,
});
// при ошибке событие вернётся на место после перечитывания
sample({
  clock: moveFx.failData,
  fn: (e) => t.errors.moveFailed(e.message),
  target: actionFailed,
});

sample({ clock: [saveFx.done, deleteFx.done, moveFx.finally, rsvpFx.done], target: reloadRequested });
rsvpFx.done.watch(() => broadcast("events-changed", { from: "main" }));
moveFx.done.watch(() => broadcast("events-changed", { from: "main" }));
// ошибки самого интерфейса при сохранении (ответы Google пишет Rust) — в журнал
for (const [name, fx] of [["save", saveFx], ["delete", deleteFx], ["move", moveFx]] as const) {
  fx.failData.watch((e) => e.kind === "other" && logError(`${name} event failed`, e));
}

// виджет перечитает события
saveFx.done.watch(() => broadcast("events-changed", { from: "main" }));
deleteFx.done.watch(() => broadcast("events-changed", { from: "main" }));

sample({
  clock: [saveFx.failData, deleteFx.failData, moveFx.failData, loadSeriesFx.failData, rsvpFx.failData],
  filter: (e) => e.kind === "not_signed_in",
  target: sessionLost,
});
