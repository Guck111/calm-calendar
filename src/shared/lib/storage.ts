// Small UI settings (view, hidden calendars). Storage may be unavailable — don't crash.

export const readJson = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
};

export const writeJson = (key: string, value: unknown): void => {
  try {
    saveJson(key, value);
  } catch {
    // no space or storage disabled — the setting just won't be remembered
  }
};

/** Write that must not fail silently: throws when there is no space or storage is disabled */
export const saveJson = (key: string, value: unknown): void => {
  localStorage.setItem(key, JSON.stringify(value));
};

export const removeJson = (key: string): void => {
  try {
    localStorage.removeItem(key);
  } catch {
    // storage disabled — nothing is stored either
  }
};
