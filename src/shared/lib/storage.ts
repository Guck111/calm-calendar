// Мелкие настройки интерфейса (вид, скрытые календари). Хранилище может быть недоступно — не падаем.

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
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // нет места или хранилище отключено — настройка просто не запомнится
  }
};
