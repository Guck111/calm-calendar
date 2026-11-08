// Последние ответы Google на запросы чтения. Без сети календарь и виджет показывают их,
// а интерфейс пишет, от какого времени эти данные.
// Хранятся в localStorage (общий у главного окна и виджета), стираются при входе и выходе.

const KEY = "calm.cache.v1";
/** столько последних запросов помним: виды за несколько недель и месяцев по всем календарям */
const MAX_ENTRIES = 80;

export type CacheEntry = { at: number; body: unknown };
type Stored = Record<string, CacheEntry>;

const storage = (): Storage | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

// копия в памяти: хранилище может быть недоступно, а читать каждый раз JSON дорого
let memory: Stored | null = null;

const load = (): Stored => {
  if (memory) return memory;
  try {
    memory = JSON.parse(storage()?.getItem(KEY) ?? "{}") as Stored;
  } catch {
    memory = {};
  }
  return memory;
};

const save = (data: Stored): void => {
  memory = data;
  const store = storage();
  if (!store) return;
  let entries = Object.entries(data);
  // не влезло — выбрасываем старую половину и пробуем ещё раз
  while (entries.length) {
    try {
      store.setItem(KEY, JSON.stringify(Object.fromEntries(entries)));
      return;
    } catch {
      entries = entries.sort(([, a], [, b]) => b.at - a.at).slice(0, Math.floor(entries.length / 2));
      memory = Object.fromEntries(entries);
    }
  }
};

export const cacheKey = (path: string, query?: Record<string, string>): string =>
  query ? `${path}?${new URLSearchParams(query).toString()}` : path;

export const remember = (key: string, body: unknown, now = Date.now()): void => {
  const data = { ...load(), [key]: { at: now, body } };
  const keys = Object.keys(data);
  if (keys.length > MAX_ENTRIES) {
    keys
      .sort((a, b) => data[a].at - data[b].at)
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach((k) => delete data[k]);
  }
  save(data);
};

export const recall = (key: string): CacheEntry | undefined => {
  // другое окно могло дописать свежие ответы: перечитываем хранилище, если оно есть
  if (storage()) memory = null;
  return load()[key];
};

export const clearCache = (): void => {
  memory = {};
  try {
    storage()?.removeItem(KEY);
  } catch {
    // хранилище недоступно — в памяти уже пусто
  }
};

/** Работаем ли сейчас на сохранённых данных: время самых старых показанных или null */
type Listener = (offlineSince: number | null) => void;
const listeners = new Set<Listener>();
let offlineSince: number | null = null;

export const onConnectionChange = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const setOffline = (value: number | null) => {
  if (value === offlineSince) return;
  offlineSince = value;
  listeners.forEach((l) => l(value));
};

export const markOnline = (): void => setOffline(null);
export const markOffline = (at: number): void => setOffline(offlineSince === null ? at : Math.min(offlineSince, at));
