import type { Meeting } from "../lib/meeting";

export type AccessRole = "owner" | "writer" | "reader" | "freeBusyReader";

export type Calendar = {
  /** id внутри приложения: аккаунт и id календаря в Google вместе, см. calendarRef */
  id: string;
  /** id календаря в Google; у разных аккаунтов может совпадать (общие календари, праздники) */
  googleId: string;
  /** email аккаунта Google, через который календарь виден */
  account: string;
  name: string;
  color: string;
  textColor: string;
  accessRole: AccessRole;
  primary: boolean;
  /** включён ли календарь в самом Google */
  selected: boolean;
  /** напоминания по умолчанию, минуты до начала */
  defaultReminders: number[];
  /** пояс календаря в Google: в нём живут события, у которых свой пояс не указан */
  timeZone?: string;
  /** праздники страны, выбранной в настройках приложения: в списке календарей Google их нет */
  holiday?: boolean;
  /** подписка на календарь .ics по ссылке из настроек: только для чтения, Google о ней не знает */
  feed?: boolean;
};

/** время события в Google: date для событий на весь день, dateTime для остальных */
export type EventTime = { date?: string; dateTime?: string; timeZone?: string };

export type CalendarEvent = {
  /** уникален среди всех календарей */
  key: string;
  id: string;
  /** календарь внутри приложения (Calendar.id) */
  calendarId: string;
  /** email аккаунта Google */
  account: string;
  /** общий id встречи во всех календарях: одна встреча в двух аккаунтах — не пересечение */
  iCalUID?: string;
  /** та же встреча (общий iCalUID) в календарях других аккаунтов: на экране она одна, тут id остальных */
  alsoIn?: string[];
  /** в Google отмечено «свободен»: такое событие ни с чем не пересекается */
  free?: boolean;
  title: string;
  start: Date;
  /** не включительно: для события на весь день это полночь следующего дня */
  end: Date;
  allDay: boolean;
  /** пояс события в Google (start.timeZone), без него — пояс календаря; у событий на весь день нет */
  timeZone?: string;
  /** пояс конца, только если в Google он другой, чем у начала */
  endTimeZone?: string;
  location?: string;
  description?: string;
  htmlLink?: string;
  /** видеовстреча: Meet, Zoom, Teams… */
  meeting?: Meeting;
  recurring: boolean;
  /** у повторения серии: id главного события и исходное время этого повторения */
  recurringEventId?: string;
  originalStart?: EventTime;
  /** минуты до начала; "default" — как задано у календаря */
  reminders?: number[] | "default";
  /** время в пути до события, минуты; хранится в скрытых полях события в Google */
  travelMinutes?: number;
  /** участники встречи; нет — встреча без гостей */
  attendees?: Attendee[];
  /** организатор — этот аккаунт: только он может менять список гостей */
  organizerSelf?: boolean;
  /** свой цвет события в Google (1–11); нет — цвет календаря */
  colorId?: string;
  /** прикреплённые файлы Google Диска */
  attachments?: Attachment[];
};

/** вложение события: файл Google Диска */
export type Attachment = { fileUrl: string; title: string; mimeType?: string; fileId?: string };

/** участник встречи, как его отдаёт Google */
export type Attendee = {
  email: string;
  displayName?: string;
  responseStatus?: "needsAction" | "declined" | "tentative" | "accepted";
  /** это сам аккаунт */
  self?: boolean;
  organizer?: boolean;
  optional?: boolean;
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
  /** пояс, по часам которого заданы дата и время в форме; нет — пояс системы */
  timeZone?: string;
  /** у конца в Google свой пояс: сохраняем его, пока пояс в форме не меняли */
  endTimeZone?: string;
  location: string;
  description: string;
  /** правило повтора (строки RRULE, EXDATE…); пусто — не повторяется */
  recurrence: string[];
  /** правило до правки; undefined — правило серии ещё не загружено */
  originalRecurrence?: string[];
  /** повторение серии: id главного события и исходное время повторения */
  recurringEventId?: string;
  originalStart?: EventTime;
  htmlLink?: string;
  /** время в пути, минуты; 0 — нет; undefined — поле не трогаем */
  travelMinutes?: number;
  /** гости; undefined — список не трогаем (событие чужое, менять его может только организатор) */
  guests?: Attendee[];
  /** создать видеовстречу Google Meet при сохранении; undefined — у события она уже есть */
  addMeet?: boolean;
  /** свой цвет события; "" — цвет календаря; undefined — не трогаем */
  colorId?: string;
  /** вложения; undefined — не трогаем (у чужой встречи их меняет организатор) */
  attachments?: Attachment[];
  /** список вложений меняли: только тогда он уходит в Google */
  attachmentsChanged?: boolean;
};

/** какие повторения серии затронуть */
export type Scope = "this" | "following";

/** аккаунт Google; signedIn false — Google отозвал доступ, нужно войти снова */
export type Account = { email: string; signedIn: boolean };

export type AuthStatus = {
  clientSource: "build" | "file" | "none";
  /** в порядке входа */
  accounts: Account[];
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

/** status — код ответа Google у ошибок kind "google" */
export type AppError = { kind: AppErrorKind; message: string; status?: number };
