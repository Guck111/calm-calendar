// Подмена Rust-команд для разработки интерфейса в обычном браузере (npm run dev без Tauri).
// В сборку приложения не попадает: подключается динамически, только если нет Tauri.
import { addDays, startOfDay, startOfWeek, toDateKey } from "../lib/date";

type Json = Record<string, unknown>;

const week = startOfWeek(new Date());
const at = (day: number, h: number, m = 0) => {
  const d = addDays(week, day);
  d.setHours(h, m);
  return d.toISOString();
};

let signedIn = true;
let seq = 100;

const calendars = [
  { id: "me@example.com", summary: "Личное", backgroundColor: "#4f8ef7", accessRole: "owner", primary: true, selected: true, defaultReminders: [{ method: "popup", minutes: 10 }] },
  { id: "work", summary: "Работа", backgroundColor: "#e8a33d", accessRole: "owner", selected: true },
  { id: "sport", summary: "Спорт", backgroundColor: "#3fb27f", accessRole: "writer", selected: true },
  { id: "pl#holiday", summary: "Праздники в Польше", backgroundColor: "#b07be8", accessRole: "reader", selected: true },
];

const events: Record<string, Json[]> = {
  "me@example.com": [
    { id: "e1", summary: "Урок английского", start: { dateTime: at(2, 19) }, end: { dateTime: at(2, 19, 50) } },
    { id: "e2", summary: "День рождения", start: { date: toDateKey(addDays(week, 5)) }, end: { date: toDateKey(addDays(week, 6)) } },
    { id: "e3", summary: "Польский", start: { dateTime: at(5, 14, 30) }, end: { dateTime: at(5, 16, 30) }, location: "Гдыня" },
  ],
  work: [0, 1, 2, 3, 4].map((d): Json => ({
    id: `w${d}`,
    summary: "Работа",
    recurringEventId: "w",
    start: { dateTime: at(d, 12) },
    end: { dateTime: at(d, 18) },
  })).concat([{ id: "w9", summary: "Созвон с командой", start: { dateTime: at(1, 14) }, end: { dateTime: at(1, 15) } }]),
  sport: [1, 3, 5].map((d) => ({
    id: `s${d}`,
    summary: "Муай-тай",
    recurringEventId: "s",
    start: { dateTime: at(d, 8) },
    end: { dateTime: at(d, 10) },
  })),
  "pl#holiday": [
    { id: "h1", summary: "Праздник", start: { date: toDateKey(addDays(startOfDay(new Date()), 9)) }, end: { date: toDateKey(addDays(startOfDay(new Date()), 10)) } },
  ],
};

const google = (method: string, path: string, query: [string, string][] = [], body?: Json): unknown => {
  const q = Object.fromEntries(query);
  if (path === "/calendar/v3/users/me/calendarList") return { items: calendars };
  const m = path.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?(\/move)?$/);
  if (!m) throw { kind: "google", message: `mock: нет обработчика ${path}` };
  const calId = decodeURIComponent(m[1]);
  const list = (events[calId] ??= []);
  const id = m[2] && decodeURIComponent(m[2]);
  const time = (t: Json) => String((t as { dateTime?: string; date?: string }).dateTime ?? (t as { date?: string }).date);

  if (method === "GET") {
    const items = list.filter((e) => {
      const start = new Date(time(e.start as Json));
      const end = new Date(time(e.end as Json));
      const text = q.q ? String(e.summary ?? "").toLowerCase().includes(q.q.toLowerCase()) : true;
      return text && start < new Date(q.timeMax) && end > new Date(q.timeMin);
    });
    return { items };
  }
  if (method === "POST" && !id) {
    const created = { ...body, id: `n${seq++}` };
    list.push(created);
    return created;
  }
  const index = list.findIndex((e) => e.id === id);
  if (index === -1) throw { kind: "google", message: "mock: событие не найдено" };
  if (m[3]) {
    const [moved] = list.splice(index, 1);
    (events[q.destination] ??= []).push(moved);
    return moved;
  }
  if (method === "PATCH") {
    list[index] = { ...list[index], ...body };
    return list[index];
  }
  if (method === "DELETE") {
    list.splice(index, 1);
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
