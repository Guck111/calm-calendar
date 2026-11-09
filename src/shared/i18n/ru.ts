// Русские строки интерфейса. Это эталон: английский словарь обязан иметь те же ключи.

import type { Freq } from "../lib/rrule";

/** 1 день, 2 дня, 5 дней */
const ruPlural = (n: number, [one, few, many]: string[]): string => {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return one;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return few;
  return many;
};

const ruUnits: Record<Freq, string[]> = {
  DAILY: ["день", "дня", "дней"],
  WEEKLY: ["неделю", "недели", "недель"],
  MONTHLY: ["месяц", "месяца", "месяцев"],
  YEARLY: ["год", "года", "лет"],
};

/** в первый понедельник, во вторую среду, в последнее воскресенье */
const ruNth = (n: number, day: number): string => {
  const names = ["воскресенье", "понедельник", "вторник", "среду", "четверг", "пятницу", "субботу"];
  const gender = [2, 0, 0, 1, 0, 1, 1][day];
  const forms = [
    ["первый", "первую", "первое"],
    ["второй", "вторую", "второе"],
    ["третий", "третью", "третье"],
    ["четвёртый", "четвёртую", "четвёртое"],
  ];
  const word = (n === -1 ? ["последний", "последнюю", "последнее"] : forms[n - 1])[gender];
  return `${word.startsWith("вт") ? "во" : "в"} ${word} ${names[day]}`;
};

export const ru = {
  common: {
    close: "Закрыть",
    cancel: "Отмена",
    save: "Сохранить",
    saving: "Сохраняю…",
    untitled: "(без названия)",
    untitledShort: "без названия",
    allDay: "Весь день",
    allDayLower: "весь день",
    today: "Сегодня",
    tomorrow: "Завтра",
    prevMonth: "Предыдущий месяц",
    nextMonth: "Следующий месяц",
    openCalendar: "Открыть календарь",
    openDay: "Открыть день",
    newEvent: "Новое событие",
    event: "Событие",
    calendar: "Календарь",
    location: "Место",
    description: "Описание",
    loading: "Загружаю…",
    settings: "Настройки",
  },
  errors: {
    notConfigured: "Не настроен клиент Google OAuth",
    notSignedIn: "Нужно войти в Google",
    denied: "Вход отменён",
    timeout: "Время ожидания входа истекло",
    missingScope: "Не выданы права на календарь. Войди заново и отметь все галочки",
    network: "Нет связи с Google. Проверь интернет",
    google: (status: number) => `Google ответил ошибкой ${status}`,
    calendarsFailed: (names: string) => `Не загрузились календари: ${names}`,
    moveFailed: (message: string) => `Не удалось перенести событие: ${message}`,
    noWritableCalendar: "Нет календаря, в который можно записать событие",
    checkDateTime: "Проверь дату и время",
    endBeforeStart: "Конец события раньше начала",
    createFailed: "Не удалось создать событие",
    titleRequired: "Добавь название",
    settingFailed: "Не удалось сохранить настройку",
    notificationsFailed: "Не удалось переключить уведомления",
    glassFailed: "Не удалось переключить эффект стекла",
    offline: (when: string) => `Нет сети. Показаны данные от ${when}`,
    otherAccount: "Событие нельзя перенести в календарь другого аккаунта Google",
    accountsFailed: (emails: string) => `Не загрузились календари аккаунта: ${emails}`,
  },
  auth: {
    clientTitle: "Подключение к Google",
    clientText:
      "Для личной сборки нужен свой клиент OAuth в Google Cloud. Как его создать, написано в README проекта. Вставь ID и секрет клиента или содержимое скачанного JSON-файла целиком.",
    clientIdLabel: "ID клиента или JSON",
    clientSecretLabel: "Секрет клиента",
    tagline: "Календарь без рекламы. Войди в Google, чтобы увидеть свои события.",
    signIn: "Войти через Google",
    finishInBrowser: "Заверши вход в браузере…",
    tabHint: "Если вкладка не открылась, проверь, не свёрнут ли браузер.",
    changeClient: "Изменить клиент OAuth",
  },
  editor: {
    allDayDate: (date: string) => `${date}, весь день`,
    delete: "Удалить",
    confirmDelete: "Точно удалить?",
    openInGoogle: "Открыть в Google Календаре",
    inGoogle: "В Google",
    recurring: "Повторяющееся событие.",
    readOnly: "Календарь только для чтения.",
    edit: "Редактировать",
    titlePlaceholder: "Название",
    start: "Начало",
    end: "Конец",
    startDate: "Дата начала",
    startTime: "Время начала",
    endDate: "Дата конца",
    endTime: "Время конца",
    timeZone: "Часовой пояс",
    yourTime: (time: string) => `По вашему времени: ${time}`,
    travel: "Время в пути",
    travelNone: "Нет",
    onTheWay: "В пути",
    travelLine: (span: string) => `В пути: ${span}`,
    guests: "Гости",
    addGuest: "Добавить гостя по email",
    removeGuest: (email: string) => `Убрать ${email}`,
    badEmail: "Это не похоже на email",
    guestStatus: { accepted: "придёт", declined: "не придёт", tentative: "может быть", needsAction: "ещё не ответил" },
    organizer: "организатор",
    invitesNote: "Гостям придёт письмо от Google о встрече и её изменениях.",
  },
  repeat: {
    label: "Повтор",
    none: "Не повторяется",
    custom: "Настроить…",
    special: "Особый повтор, настроенный в Google",
    loading: "Загружаю повтор…",
    interval: "Повторять раз в",
    unit: (freq: Freq, n: number) => ruPlural(n, ruUnits[freq]),
    days: "Дни недели",
    ends: "Окончание",
    never: "Никогда",
    until: "В дату",
    count: "После",
    countUnit: (n: number) => ruPlural(n, ["повтора", "повторов", "повторов"]),
    every: (freq: Freq, n: number) =>
      n === 1
        ? { DAILY: "Каждый день", WEEKLY: "Каждую неделю", MONTHLY: "Каждый месяц", YEARLY: "Каждый год" }[freq]
        : `Раз в ${n} ${ruPlural(n, ruUnits[freq])}`,
    weekdays: "По будням",
    onDays: (days: string) => `по ${days}`,
    onMonthDay: (n: number) => `${n}-го числа`,
    /** day — номер дня недели как в Date.getDay(), name — его название из Intl */
    onNth: (n: number, day: number, _name: string) => ruNth(n, day),
    onDate: (date: string) => date,
    untilDate: (date: string) => `до ${date}`,
    times: (n: number) => `${n} ${ruPlural(n, ["раз", "раза", "раз"])}`,
    sep: ", ",
  },
  scope: {
    saveTitle: "Сохранить повторяющееся событие",
    deleteTitle: "Удалить повторяющееся событие",
    this: "Только это событие",
    following: "Это и следующие",
    ruleChanged: "Повтор изменён, поэтому правка коснётся этого и следующих событий.",
  },
  accounts: {
    /** несколько аккаунтов Google в одном окне */
    add: "Добавить аккаунт",
    signOutTitle: (email: string) => `Выйти из ${email}`,
    expired: "Вход истёк.",
    signInAgain: "Войти снова",
    confirmSignOut: "Точно выйти?",
    alsoIn: (list: string) => `Также в: ${list}`,
    /** событие другого аккаунта в то же время */
    conflict: (list: string) => `Пересекается с: ${list}`,
  },
  meeting: {
    /** кнопка видеовстречи: Meet, Zoom, Teams */
    join: "Подключиться",
    joinTitle: (provider: string) => `Подключиться к встрече (${provider})`,
  },
  alert: {
    /** окно поверх всех окон за минуту до начала события */
    label: "Заметное напоминание",
    text: "За минуту до начала поверх всех окон появится окно с кнопками «Подключиться», «Отложить» и «Закрыть».",
    modes: { off: "Выключено", calls: "Только видеовстречи", all: "Все события со временем" },
    snooze: "Отложить на 5 мин",
    dismiss: "Закрыть",
  },
  agenda: {
    /** список дел у значка в трее */
    empty: "Ничего не запланировано",
  },
  month: {
    more: (n: number) => `ещё ${n}`,
  },
  quick: {
    example: "завтра 19:00 английский 50 мин",
    placeholder: (example: string) => `Например: ${example}`,
    widgetPlaceholder: "+ Новое событие",
    label: "Быстрое создание события",
    keys: "Enter — создать · Ctrl+Enter — подробнее",
    nextDay: "(на следующий день)",
  },
  search: {
    placeholder: "Поиск (Ctrl+F)",
    label: "Поиск событий",
    searching: "Ищу…",
    nothing: "Ничего не найдено",
  },
  settings: {
    theme: "Тема",
    themes: { system: "Как в системе", light: "Светлая", dark: "Тёмная" },
    language: "Язык",
    systemLanguage: "Как в системе",
    glass: "Эффект стекла",
    glassText: "Календарь и виджет становятся полупрозрачными, а то, что под ними, — размытым.",
    glassPower: "Windows может отключить размытие в режиме экономии энергии.",
    glassWindowsOnly: "Работает только в Windows.",
    notifications: "Уведомления о событиях",
    notificationsText:
      "По напоминаниям из Google Календаря: время задаётся в Google у события или у календаря по умолчанию.",
    privateNotifications: "Скрывать названия в уведомлениях",
    privateText:
      "Вместо названия — «Событие» и время. Пригодится, если Windows показывает уведомления на экране блокировки.",
    secondZone: "Второй часовой пояс",
    secondZoneText: "Ещё одна колонка часов в видах «Неделя» и «День».",
    weekNumbers: "Номера недель",
    weekNumbersText: "В мини-календаре, в виде «Месяц» и в заголовке недели.",
    holidays: "Праздники",
    holidaysText: "Государственные праздники страны — отдельным календарём. Видны только в этом приложении.",
    holidaysNone: "Не показывать",
    trayHint: "Виджет, «поверх окон» и автозапуск — в меню значка в трее.",
  },
  sidebar: {
    calendars: "Календари",
    create: "Создать",
    signOut: "Выйти",
    holidays: "Праздники",
  },
  toolbar: {
    views: { day: "День", week: "Неделя", month: "Месяц", agenda: "Расписание" },
    freeSlots: "Свободное время",
    theme: "Тема",
    themeTitle: (current: string, next: string) => `Тема: ${current}. Нажми, чтобы сделать ${next}`,
    themeNames: { system: "как в системе", light: "светлая", dark: "тёмная" },
    todayTitle: "Сегодня (T)",
    back: "Назад",
    forward: "Вперёд",
    refresh: "Обновить",
    view: "Вид",
  },
  widget: {
    openDay: "Открыть день в календаре",
    backToCurrentMonth: "Вернуться к текущему месяцу",
    signInHint: "Войди в Google в окне календаря",
    loadFailed: "Не удалось загрузить события. Повторить",
    noUpcoming: "Ближайших событий нет",
  },
  schedule: {
    empty: "В эти дни событий нет",
  },
  free: {
    title: "Свободное время",
    hours: "Часы",
    minLength: "Не короче",
    minutes: (n: string) => `${n} мин`,
    weekends: "Учитывать выходные",
    copy: "Скопировать",
    copied: "Скопировано",
    none: "Свободного времени нет",
    intro: (zone: string) => `Когда я свободен (${zone}):`,
    hint: "Дни на экране, начиная с сегодня. События с отметкой «свободен» и на весь день не мешают.",
  },
  time: {
    week: (n: string) => `Неделя ${n}`,
    /** «2 ч 10 мин» */
    span: (h: number, m: number) => (!h ? `${m} мин` : m ? `${h} ч ${m} мин` : `${h} ч`),
    in: (span: string) => `через ${span}`,
    ongoing: (span: string) => `идёт, ещё ${span}`,
  },
  reminders: {
    startsNow: "Начинается сейчас",
    in: (span: string) => `Через ${span}`,
    inDays: (d: number) => `Через ${d} дн.`,
    privateTitle: "Событие",
  },
};

/** Тип словаря: функции с теми же параметрами, строки — любые */
export type Dict = typeof ru;
