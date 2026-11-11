// Отдельное окно настроек (?window=settings): без рамки, тянется за шапку куда угодно,
// в том числе за пределы окна календаря. Закрывается крестиком или Esc.
import type { PointerEvent as ReactPointerEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { broadcast, inTauri } from "../shared/api/bus";
import { SettingsDialog } from "../ui/Settings";

const close = () => {
  if (inTauri) void invoke("close_settings");
};

/** окно календаря перечитает события и заново запланирует напоминания */
const reschedule = () => broadcast("events-changed", { from: "settings" });

const drag = (e: ReactPointerEvent<HTMLElement>) => {
  if (e.button !== 0 || !inTauri) return;
  if ((e.target as HTMLElement).closest("button, a, input, select, textarea")) return;
  e.preventDefault();
  void getCurrentWindow().startDragging();
};

export const SettingsWindow = () => <SettingsDialog onClose={close} onReschedule={reschedule} onHeadDrag={drag} />;
