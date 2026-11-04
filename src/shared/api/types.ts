export type AccessRole = "owner" | "writer" | "reader" | "freeBusyReader";

export type Calendar = {
  id: string;
  name: string;
  color: string;
  textColor: string;
  accessRole: AccessRole;
  primary: boolean;
  /** включён ли календарь в самом Google */
  selected: boolean;
  /** напоминания по умолчанию, минуты до начала */
  defaultReminders: number[];
};

export type CalendarEvent = {
  /** уникален среди всех календарей */
  key: string;
  id: string;
  calendarId: string;
  title: string;
  start: Date;
  /** не включительно: для события на весь день это полночь следующего дня */
  end: Date;
  allDay: boolean;
  location?: string;
  description?: string;
  htmlLink?: string;
  recurring: boolean;
  /** минуты до начала; "default" — как задано у календаря */
  reminders?: number[] | "default";
};

/** Черновик для формы создания и правки события */
export type EventDraft = {
  /** нет при создании */
  id?: string;
  /** календарь, в котором событие лежит сейчас */
  originalCalendarId?: string;
  calendarId: string;
  title: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  location: string;
  description: string;
  recurring: boolean;
  htmlLink?: string;
};

export type AuthStatus = {
  clientSource: "build" | "file" | "none";
  signedIn: boolean;
  email: string | null;
};

export type AppErrorKind =
  | "not_configured"
  | "not_signed_in"
  | "denied"
  | "timeout"
  | "missing_scope"
  | "google"
  | "network"
  | "other";

export type AppError = { kind: AppErrorKind; message: string };
