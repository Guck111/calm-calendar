import type { Meeting } from "../lib/meeting";

export type AccessRole = "owner" | "writer" | "reader" | "freeBusyReader";

export type Calendar = {
  /** id inside the app: account and Google calendar id together, see calendarRef */
  id: string;
  /** calendar id in Google; may match across accounts (shared calendars, holidays) */
  googleId: string;
  /** email of the Google account through which the calendar is visible */
  account: string;
  name: string;
  color: string;
  textColor: string;
  accessRole: AccessRole;
  primary: boolean;
  /** whether the calendar is enabled in Google itself */
  selected: boolean;
  /** default reminders, minutes before start */
  defaultReminders: number[];
  /** calendar time zone in Google: events without their own time zone live in it */
  timeZone?: string;
  /** holidays of the country chosen in app settings: they are not in the Google calendar list */
  holiday?: boolean;
  /** subscription to an .ics calendar by link from settings: read-only, Google doesn't know about it */
  feed?: boolean;
};

/** event time in Google: date for all-day events, dateTime for the rest */
export type EventTime = { date?: string; dateTime?: string; timeZone?: string };

export type CalendarEvent = {
  /** unique across all calendars */
  key: string;
  id: string;
  /** calendar inside the app (Calendar.id) */
  calendarId: string;
  /** Google account email */
  account: string;
  /** shared meeting id across all calendars: one meeting in two accounts is not an overlap */
  iCalUID?: string;
  /** the same meeting (shared iCalUID) in calendars of other accounts: it's one on screen, here are the other ids */
  alsoIn?: string[];
  /** marked "free" in Google: such an event overlaps nothing */
  free?: boolean;
  title: string;
  start: Date;
  /** exclusive: for an all-day event it's midnight of the next day */
  end: Date;
  allDay: boolean;
  /** event time zone in Google (start.timeZone), without it — the calendar's time zone; all-day events have none */
  timeZone?: string;
  /** end time zone, only if in Google it differs from the start's */
  endTimeZone?: string;
  location?: string;
  description?: string;
  htmlLink?: string;
  /** video meeting: Meet, Zoom, Teams… */
  meeting?: Meeting;
  recurring: boolean;
  /** for a series occurrence: master event id and the original time of this occurrence */
  recurringEventId?: string;
  originalStart?: EventTime;
  /** minutes before start; "default" — as set on the calendar */
  reminders?: number[] | "default";
  /** travel time to the event, minutes; stored in the event's hidden fields in Google */
  travelMinutes?: number;
  /** meeting attendees; none — a meeting without guests */
  attendees?: Attendee[];
  /** the organizer is this account: only it can change the guest list */
  organizerSelf?: boolean;
  /** the event's own color in Google (1–11); none — the calendar color */
  colorId?: string;
  /** attached Google Drive files */
  attachments?: Attachment[];
};

/** event attachment: a Google Drive file */
export type Attachment = { fileUrl: string; title: string; mimeType?: string; fileId?: string };

/** meeting attendee as Google returns it */
export type Attendee = {
  email: string;
  displayName?: string;
  responseStatus?: "needsAction" | "declined" | "tentative" | "accepted";
  /** this is the account itself */
  self?: boolean;
  organizer?: boolean;
  optional?: boolean;
};

/** Draft for the event create and edit form */
export type EventDraft = {
  /** absent on create */
  id?: string;
  /** the calendar the event is in now */
  originalCalendarId?: string;
  calendarId: string;
  title: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  /** time zone whose clock defines the date and time in the form; none — the system time zone */
  timeZone?: string;
  /** the end has its own time zone in Google: keep it as long as the time zone in the form wasn't changed */
  endTimeZone?: string;
  /** Original instants for picking the right offset in a repeated autumn hour. */
  originalTimes?: { zone: string; start: Date; end: Date };
  location: string;
  description: string;
  /** recurrence rule (RRULE, EXDATE… lines); empty — doesn't repeat */
  recurrence: string[];
  /** rule before editing; undefined — the series rule isn't loaded yet */
  originalRecurrence?: string[];
  /** series occurrence: master event id and the original time of the occurrence */
  recurringEventId?: string;
  originalStart?: EventTime;
  htmlLink?: string;
  /** travel time, minutes; 0 — none; undefined — leave the field alone */
  travelMinutes?: number;
  /** guests; undefined — leave the list alone (someone else's event, only the organizer can change it) */
  guests?: Attendee[];
  /** create a Google Meet video meeting on save; undefined — the event already has one */
  addMeet?: boolean;
  /** the event's own color; "" — calendar color; undefined — leave alone */
  colorId?: string;
  /** attachments; undefined — leave alone (for someone else's meeting the organizer changes them) */
  attachments?: Attachment[];
  /** the attachment list was changed: only then it goes to Google */
  attachmentsChanged?: boolean;
  /** request body fields (JSON) when the existing event was opened; on save only changed fields are sent */
  baseline?: Record<string, string>;
};

/** which series occurrences to affect */
export type Scope = "this" | "following";

/** Google account; signedIn false — Google revoked access, need to sign in again */
export type Account = { email: string; signedIn: boolean };

export type AuthStatus = {
  clientSource: "build" | "file" | "none";
  /** in sign-in order */
  accounts: Account[];
};

export type AppErrorKind =
  | "not_configured"
  | "not_signed_in"
  | "denied"
  | "timeout"
  | "cancelled"
  | "missing_scope"
  | "google"
  | "network"
  | "other";

/** status — Google response code for errors of kind "google" */
export type AppError = { kind: AppErrorKind; message: string; status?: number };
