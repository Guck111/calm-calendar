// Подмена Rust-команд для разработки интерфейса в обычном браузере (npm run dev без Tauri).
// В сборку приложения не попадает: подключается динамически, только если нет Tauri.
import { lang } from "../i18n";
import { addDays, localTimeZone, startOfDay, startOfWeek, toDateKey } from "../lib/date";
import { occurrences, parseRecurrence, utcStamp } from "../lib/rrule";

type Json = Record<string, unknown>;

const week = startOfWeek(new Date());
const at = (day: number, h: number, m = 0) => {
  const d = addDays(week, day);
  d.setHours(h, m);
  return d.toISOString();
};

// серии начинаются с понедельника две недели назад: есть и прошлые повторения, и первое для «всей серии»
const monday = addDays(startOfDay(new Date()), -((new Date().getDay() + 6) % 7) - 14);
const series = (day: number, h: number, m = 0) => {
  const d = addDays(monday, day);
  d.setHours(h, m);
  return d.toISOString();
};
const WEEKDAYS_RULE = "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
/** второй вторник позапрошлого месяца */
const secondTuesday = (h: number) => {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  return new Date(first.getFullYear(), first.getMonth(), 8 + ((2 - first.getDay() + 7) % 7), h).toISOString();
};

const soon = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
const MEET = "https://meet.google.com/abc-defg-hij";
const ZOOM = "https://us02web.zoom.us/j/81234567890?pwd=calm";

// два аккаунта: личный и рабочий; календарь «work» живёт в рабочем, остальные — в личном
const ME = "me@example.com";
const WORK = "work@example.com";
let accounts = [ME, WORK];
const ownerOf = (calendarId: string) => (calendarId === "work" ? WORK : ME);
let seq = 100;

// русские данные — для разработки, английские — ещё и для скриншотов сайта и Store
const ruCalendars = [
  { id: "me@example.com", summary: "Личное", backgroundColor: "#4f8ef7", accessRole: "owner", primary: true, selected: true, defaultReminders: [{ method: "popup", minutes: 10 }] },
  { id: "work", summary: "Работа", backgroundColor: "#e8a33d", accessRole: "owner", selected: true },
  { id: "sport", summary: "Спорт", backgroundColor: "#3fb27f", accessRole: "writer", selected: true },
  { id: "pl#holiday", summary: "Праздники в Польше", backgroundColor: "#b07be8", accessRole: "reader", selected: true },
];

const ruEvents = (): Record<string, Json[]> => ({
  "me@example.com": [
    { id: "e1", summary: "Урок английского", start: { dateTime: at(2, 19) }, end: { dateTime: at(2, 19, 50) } },
    { id: "e2", summary: "День рождения", start: { date: toDateKey(addDays(week, 5)) }, end: { date: toDateKey(addDays(week, 6)) } },
    { id: "e3", summary: "Польский", start: { dateTime: at(5, 14, 30) }, end: { dateTime: at(5, 16, 30) }, location: "Гдыня", extendedProperties: { private: { calmTravelMinutes: "45" } } },
    // в рабочее время из рабочего аккаунта: пересечение
    { id: "e4", summary: "Стоматолог", start: { dateTime: at(3, 16) }, end: { dateTime: at(3, 17) } },
    // позвали оба аккаунта: на экране одна встреча
    { id: "e5", iCalUID: "demo-both@example.com", summary: "Встреча выпускников", start: { dateTime: at(4, 18) }, end: { dateTime: at(4, 19) } },
  ],
  work: ([
    {
      id: "w",
      summary: "Работа",
      recurrence: [WEEKDAYS_RULE],
      start: { dateTime: series(0, 12) },
      end: { dateTime: series(0, 18) },
    },
  ] as Json[]).concat([
    { id: "w12", iCalUID: "demo-both@example.com", summary: "Встреча выпускников", start: { dateTime: at(4, 18) }, end: { dateTime: at(4, 19) } },
    {
      id: "w9",
      summary: "Созвон с командой",
      start: { dateTime: at(1, 14) },
      end: { dateTime: at(1, 15) },
      hangoutLink: MEET,
      organizer: { email: WORK, self: true },
      attendees: [
        { email: WORK, self: true, organizer: true, responseStatus: "accepted" },
        { email: "anna@example.com", displayName: "Анна", responseStatus: "accepted" },
        { email: "oleg@example.com", responseStatus: "declined" },
        { email: "ivan@example.com", responseStatus: "needsAction" },
      ],
    },
    // начинается через 10 минут: в виджете видна кнопка «Подключиться»
    { id: "w10", summary: "Планёрка", start: { dateTime: soon(10) }, end: { dateTime: soon(40) }, location: ZOOM },
    // создано в поясе Нью-Йорка: форма показывает время там и «по вашему времени»
    {
      id: "w11",
      summary: "Созвон с Нью-Йорком",
      start: { dateTime: at(4, 17), timeZone: "America/New_York" },
      end: { dateTime: at(4, 18), timeZone: "America/New_York" },
      hangoutLink: MEET,
    },
  ]),
  sport: [
    {
      id: "s",
      summary: "Муай-тай",
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU,TH,SA"],
      start: { dateTime: series(1, 8) },
      end: { dateTime: series(1, 10) },
    },
    // каждый месяц во второй вторник, 10 раз
    {
      id: "m",
      summary: "Уборка",
      recurrence: [`RRULE:FREQ=MONTHLY;BYDAY=2TU;COUNT=10`],
      start: { dateTime: secondTuesday(19) },
      end: { dateTime: secondTuesday(20) },
    },
  ],
  "pl#holiday": [
    { id: "h1", summary: "Праздник", start: { date: toDateKey(addDays(startOfDay(new Date()), 9)) }, end: { date: toDateKey(addDays(startOfDay(new Date()), 10)) } },
  ],
});

const enCalendars = [
  { id: "me@example.com", summary: "Personal", backgroundColor: "#4f8ef7", accessRole: "owner", primary: true, selected: true, defaultReminders: [{ method: "popup", minutes: 10 }] },
  { id: "work", summary: "Work", backgroundColor: "#e8a33d", accessRole: "owner", selected: true },
  { id: "fitness", summary: "Fitness", backgroundColor: "#3fb27f", accessRole: "owner", selected: true },
  { id: "family", summary: "Family", backgroundColor: "#b07be8", accessRole: "writer", selected: true },
];

type Plan = [day: number, title: string, from: [number, number], to: [number, number], extra?: Json];
const timed = (prefix: string, plan: Plan[]): Json[] =>
  plan.map(([day, summary, [h1, m1], [h2, m2], extra], i) => ({
    id: `${prefix}${i}`,
    summary,
    start: { dateTime: at(day, h1, m1) },
    end: { dateTime: at(day, h2, m2) },
    ...extra,
  }));

// неделя считается от первого дня недели региона: для en-US 0 — воскресенье
const enEvents = (): Record<string, Json[]> => ({
  "me@example.com": timed("p", [
    [0, "Brunch with Anna", [11, 0], [12, 30], { location: "Blue Door Cafe" }],
    [2, "Dentist", [16, 0], [16, 45], { location: "Main St Clinic" }],
    [3, "Spanish class", [19, 0], [19, 50]],
    [6, "Farmers market", [10, 0], [11, 0]],
  ]),
  work: [
    {
      id: "su",
      summary: "Team standup",
      recurrence: [WEEKDAYS_RULE],
      hangoutLink: MEET,
      start: { dateTime: series(0, 9, 30) },
      end: { dateTime: series(0, 9, 45) },
    },
    ...timed("w", [
      [1, "Product review", [14, 0], [15, 0]],
      [
        2,
        "Design sync",
        [11, 0],
        [12, 0],
        {
          description: `Agenda and notes in the doc. Join Zoom: ${ZOOM}`,
          attachments: [
            {
              fileUrl: "https://docs.google.com/document/d/1DesignSyncAgenda/edit",
              title: "Design sync agenda",
              mimeType: "application/vnd.google-apps.document",
              fileId: "1DesignSyncAgenda",
            },
          ],
        },
      ],
      // в то же время, что и Dentist в личном аккаунте: пересечение
      [2, "Hiring panel", [15, 30], [16, 30]],
      [3, "Focus time", [13, 0], [16, 0]],
      // чужая встреча, рабочий аккаунт приглашён и ещё не ответил
      [
        1,
        "Quarterly planning",
        [16, 0],
        [17, 0],
        {
          organizer: { email: "boss@example.com", displayName: "Kate" },
          attendees: [
            { email: "boss@example.com", displayName: "Kate", organizer: true, responseStatus: "accepted" },
            { email: WORK, self: true, responseStatus: "needsAction" },
            { email: "sam@example.com", displayName: "Sam", responseStatus: "tentative" },
          ],
        },
      ],
      [
        4,
        "1:1 with Sam",
        [10, 0],
        [10, 30],
        {
          conferenceData: {
            conferenceSolution: { name: "Microsoft Teams Meeting" },
            entryPoints: [{ entryPointType: "video", uri: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_calm/0" }],
          },
        },
      ],
      [5, "Sprint demo", [15, 0], [16, 0]],
    ]),
  ],
  fitness: timed("f", [
    [1, "Yoga", [18, 30], [19, 30]],
    [4, "Morning run", [7, 0], [8, 0]],
    [6, "Hike", [13, 0], [17, 0], { location: "Cedar Ridge Trail" }],
  ]),
  family: [
    ...timed("fa", [[4, "Dinner with parents", [19, 0], [21, 0]]]),
    { id: "fb", summary: "Mom's birthday", start: { date: toDateKey(addDays(week, 4)) }, end: { date: toDateKey(addDays(week, 5)) } },
  ],
});

// подставные данные — русские или английские; для остальных языков английские
const english = lang !== "ru";
const calendars = english ? enCalendars : ruCalendars;
const events: Record<string, Json[]> = english ? enEvents() : ruEvents();

type Time = { dateTime?: string | null; date?: string | null };
const time = (t: unknown) => String((t as Time).dateTime ?? (t as Time).date);
const startOf = (e: Json) => new Date(time(e.start));
const endOf = (e: Json) => new Date(time(e.end));
const isSeries = (e: Json) => Array.isArray(e.recurrence) && e.recurrence.length > 0;

// Серии хранятся, как в Google: главное событие с правилом, а изменённые и удалённые повторения —
// отдельными записями с recurringEventId. Повторения разворачиваются при чтении.
const expand = (master: Json, before: Date): Json[] => {
  const start = startOf(master);
  const allDay = Boolean((master.start as Time).date);
  const { rule } = parseRecurrence(master.recurrence as string[], start);
  const dates = rule ? occurrences(rule, start, before) : [start];
  const days = Math.round((endOf(master).getTime() - start.getTime()) / 86_400_000);
  const duration = endOf(master).getTime() - start.getTime();
  const { recurrence: _, ...rest } = master;
  return dates.map((at) => {
    const t = (d: Date) => (allDay ? { date: toDateKey(d) } : { dateTime: d.toISOString() });
    return {
      ...rest,
      id: `${master.id}_${allDay ? toDateKey(at).replaceAll("-", "") : utcStamp(at)}`,
      recurringEventId: master.id,
      originalStartTime: t(at),
      start: t(at),
      end: t(allDay ? addDays(at, days) : new Date(at.getTime() + duration)),
    };
  });
};

/** события календаря с развёрнутыми сериями, включая удалённые повторения */
const flatten = (list: Json[], before: Date): Json[] => {
  const changed = new Map(list.filter((e) => e.recurringEventId).map((e) => [e.id, e]));
  return list.flatMap((e) => {
    if (e.recurringEventId) return [];
    if (!isSeries(e)) return [e];
    return expand(e, before).map((i) => changed.get(i.id) ?? i);
  });
};

const FAR = new Date(2100, 0, 1);

/** Заявка на Google Meet (conferenceData.createRequest): Google создаёт встречу и отдаёт ссылку.
 *  Без conferenceDataVersion=1 Google заявку молча пропускает */
const withMeet = (body: Json | undefined, q: Record<string, string>): Json | undefined => {
  const request = (body?.conferenceData as { createRequest?: unknown } | undefined)?.createRequest;
  if (!body || !request || q.conferenceDataVersion !== "1") return body;
  const code = `mock-${(seq++).toString(36).padStart(4, "a")}-xyz`.replace(/[^a-z-]/g, "q");
  const uri = `https://meet.google.com/${code}`;
  return {
    ...body,
    hangoutLink: uri,
    conferenceData: {
      conferenceSolution: { name: "Google Meet", key: { type: "hangoutsMeet" } },
      entryPoints: [{ entryPointType: "video", uri }],
    },
  };
};

const google = (
  account: string,
  method: string,
  path: string,
  query: [string, string][] = [],
  body?: Json,
): unknown => {
  const q = Object.fromEntries(query);
  if (!accounts.includes(account)) throw { kind: "not_signed_in", message: "mock" };
  if (path === "/calendar/v3/users/me/calendarList") {
    return { items: calendars.filter((c) => ownerOf(c.id) === account) };
  }
  const m = path.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?(\/move|\/instances)?$/);
  if (!m) throw { kind: "google", message: `mock: нет обработчика ${path}` };
  const calId = decodeURIComponent(m[1]);
  // публичный календарь праздников страны: два праздника в каждом месяце диапазона
  if (calId.endsWith("#holiday@group.v.calendar.google.com") && method === "GET") {
    const from = new Date(q.timeMin);
    const items: Json[] = [];
    for (let d = new Date(from.getFullYear(), from.getMonth(), 1); d < new Date(q.timeMax); d.setMonth(d.getMonth() + 1)) {
      for (const day of [11, 25]) {
        const date = new Date(d.getFullYear(), d.getMonth(), day);
        items.push({
          id: `h${toDateKey(date)}`,
          summary: `Праздник ${calId.split("#")[0]}`,
          start: { date: toDateKey(date) },
          end: { date: toDateKey(addDays(date, 1)) },
          transparency: "transparent",
        });
      }
    }
    return { items, timeZone: localTimeZone() };
  }
  if (ownerOf(calId) !== account) throw { kind: "google", message: "404: Not Found" };
  const list = (events[calId] ??= []);
  const id = m[2] && decodeURIComponent(m[2]);
  const byStart = (a: Json, b: Json) => startOf(a).getTime() - startOf(b).getTime();

  if (method === "GET" && !id) {
    const items = flatten(list, new Date(q.timeMax)).filter((e) => {
      const text = q.q ? String(e.summary ?? "").toLowerCase().includes(q.q.toLowerCase()) : true;
      return text && e.status !== "cancelled" && startOf(e) < new Date(q.timeMax) && endOf(e) > new Date(q.timeMin);
    });
    // как Google: у списка событий указан пояс календаря
    return { items: items.sort(byStart), timeZone: localTimeZone() };
  }
  body = withMeet(body, q);
  if (method === "POST" && !id) {
    const created = { ...body, id: `n${seq++}` };
    list.push(created);
    return created;
  }
  const index = list.findIndex((e) => e.id === id);
  if (m[3] === "/instances") {
    if (index === -1) throw { kind: "google", message: "mock: серия не найдена" };
    const items = flatten([list[index], ...list.filter((e) => e.recurringEventId === id)], new Date(q.timeMax ?? FAR));
    return { items: q.showDeleted === "true" ? items : items.filter((e) => e.status !== "cancelled") };
  }
  // повторение, которое ещё не меняли, существует только в развёрнутом виде
  const instance = index === -1 ? flatten(list, FAR).find((e) => e.id === id) : undefined;
  if (index === -1 && !instance) throw { kind: "google", message: "mock: событие не найдено" };
  if (method === "GET") return list[index] ?? instance;
  if (m[3] === "/move") {
    const [moved] = list.splice(index, 1);
    (events[q.destination] ??= []).push(moved);
    return moved;
  }
  // ответ на приглашение: Google меняет только ответы перечисленных гостей, остальной список остаётся
  if (method === "PATCH" && body?.attendeesOmitted) {
    const current = list[index] ?? instance;
    const answers = new Map((body.attendees as { email: string; responseStatus: string }[]).map((a) => [a.email, a.responseStatus]));
    const attendees = ((current?.attendees as { email: string }[] | undefined) ?? []).map((a) =>
      answers.has(a.email) ? { ...a, responseStatus: answers.get(a.email) } : a,
    );
    const { attendeesOmitted: _, attendees: __, ...rest } = body;
    body = { ...rest, attendees };
  }
  if (method === "PATCH") {
    if (instance) {
      list.push({ ...instance, ...body });
      return list[list.length - 1];
    }
    list[index] = { ...list[index], ...body };
    return list[index];
  }
  if (method === "DELETE") {
    if (instance) list.push({ ...instance, status: "cancelled" });
    else {
      list.splice(index, 1);
      // вместе с серией уходят и её изменённые повторения
      events[calId] = list.filter((e) => e.recurringEventId !== id);
    }
    return null;
  }
  throw { kind: "other", message: `mock: ${method}` };
};

/** Для автотестов: window.calmMock.outage = "network" | "503" — Google не отвечает, null — снова отвечает */
const mockControl: { outage: "network" | "503" | null } = { outage: null };
(globalThis as unknown as { calmMock: typeof mockControl }).calmMock = mockControl;

const delay = <T>(value: T, ms = 250) => new Promise<T>((r) => setTimeout(() => r(value), ms));

export const mockInvoke = async (cmd: string, args: Json = {}): Promise<unknown> => {
  switch (cmd) {
    case "auth_status":
      return { client_source: "file", accounts: accounts.map((email) => ({ email, signed_in: true })) };
    case "sign_in": {
      // входим в первый из двух аккаунтов, которого ещё нет
      const next = [ME, WORK].find((a) => !accounts.includes(a)) ?? ME;
      accounts = [...new Set([...accounts, next])];
      return delay(next, 800);
    }
    case "sign_out":
      accounts = args.account ? accounts.filter((a) => a !== args.account) : [];
      return null;
    case "save_client_config":
      return null;
    case "google_request":
      if (mockControl.outage === "network") throw { kind: "network", message: "mock: no network" };
      if (mockControl.outage === "503") throw { kind: "google", message: "503: Backend Error" };
      return delay(
        google(
          String(args.account),
          String(args.method),
          String(args.path),
          args.query as [string, string][] | undefined,
          args.body as Json | undefined,
        ),
      );
    default:
      throw { kind: "other", message: `mock: неизвестная команда ${cmd}` };
  }
};
