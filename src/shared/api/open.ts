// Открыть ссылку в браузере по умолчанию: в приложении — через плагин opener,
// в разработке интерфейса в обычном браузере — новой вкладкой.
import { inTauri } from "./bus";

export const openExternal = async (url: string): Promise<void> => {
  if (!inTauri) {
    window.open(url, "_blank", "noopener");
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
};
