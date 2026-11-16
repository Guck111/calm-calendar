// Last Google responses to read requests. Without network the calendar and widget show them,
// and the UI says how old this data is.
// Stored in localStorage (shared by the main window and widget), erased on sign-in and sign-out.

const KEY = "calm.cache.v1";
/** how many recent requests we remember: views over several weeks and months for all calendars */
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

// in-memory copy: storage may be unavailable, and parsing JSON every time is expensive
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
  // didn't fit — drop the older half and try again
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
  // another window could have written fresh responses: reread the storage if it exists
  if (storage()) memory = null;
  return load()[key];
};

export const clearCache = (): void => {
  memory = {};
  try {
    storage()?.removeItem(KEY);
  } catch {
    // storage is unavailable — memory is already empty
  }
};

/** Whether we are working on saved data now: time of the oldest shown data or null */
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
