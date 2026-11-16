// Open a link in the default browser: in the app — via the opener plugin,
// when developing the UI in a regular browser — in a new tab.
import { inTauri } from "./bus";

export const openExternal = async (url: string): Promise<void> => {
  if (!inTauri) {
    window.open(url, "_blank", "noopener");
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
};
