// Подмена Rust-команд для разработки интерфейса в обычном браузере (npm run dev без Tauri).
// В сборку приложения не попадает: подключается динамически, только если нет Tauri.
import { lang } from "../i18n";
import { addDays, startOfDay, startOfWeek, toDateKey } from "../lib/date";
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

let signedIn = true;
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
    { id: "e3", summary: "Польский", start: { dateTime: at(5, 14, 30) }, end: { dateTime: at(5, 16, 30) }, location: "Гдыня" },
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
    { id: "w9", summary: "Созвон с командой", start: { dateTime: at(1, 14) }, end: { dateTime: at(1, 15) }, hangoutLink: MEET },
    // начинается через 10 минут: в виджете видна кнопка «Подключиться»
    { id: "w10", summary: "Планёрка", start: { dateTime: soon(10) }, end: { dateTime: soon(40) }, location: ZOOM },
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
      [2, "Design sync", [11, 0], [12, 0], { description: `Agenda and notes in the doc. Join Zoom: ${ZOOM}` }],
      [3, "Focus time", [13, 0], [16, 0]],
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

const google = (method: string, path: string, query: [string, string][] = [], body?: Json): unknown => {
  const q = Object.fromEntries(query);
  if (path === "/calendar/v3/users/me/calendarList") return { items: calendars };
  const m = path.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?(\/move|\/instances)?$/);
  if (!m) throw { kind: "google", message: `mock: нет обработчика ${path}` };
  const calId = decodeURIComponent(m[1]);
  const list = (events[calId] ??= []);
  const id = m[2] && decodeURIComponent(m[2]);
  const byStart = (a: Json, b: Json) => startOf(a).getTime() - startOf(b).getTime();

  if (method === "GET" && !id) {
    const items = flatten(list, new Date(q.timeMax)).filter((e) => {
      const text = q.q ? String(e.summary ?? "").toLowerCase().includes(q.q.toLowerCase()) : true;
      return text && e.status !== "cancelled" && startOf(e) < new Date(q.timeMax) && endOf(e) > new Date(q.timeMin);
    });
    return { items: items.sort(byStart) };
  }
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

const delay = <T>(value: T, ms = 250) => new Promise<T>((r) => setTimeout(() => r(value), ms));

export const mockInvoke = async (cmd: string, args: Json = {}): Promise<unknown> => {
  switch (cmd) {
    case "auth_status":
      return { client_source: "file", signed_in: signedIn, email: signedIn ? "me@example.com" : null };
    case "sign_in":
      signedIn = true;
      return delay("me@example.com", 800);
    case "sign_out":
      signedIn = false;
      return null;
    case "save_client_config":
      return null;
    case "google_request":
      return delay(
        google(
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
