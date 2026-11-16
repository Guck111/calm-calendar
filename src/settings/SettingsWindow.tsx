// Separate settings window (?window=settings): frameless, can be dragged by its header anywhere,
// including outside the calendar window. Closes with the cross or Esc.
import type { PointerEvent as ReactPointerEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { broadcast, inTauri } from "../shared/api/bus";
import { SettingsDialog } from "../ui/Settings";

const close = () => {
  if (inTauri) void invoke("close_settings");
};

/** the calendar window will reload events and reschedule reminders */
const reschedule = () => broadcast("events-changed", { from: "settings" });

const drag = (e: ReactPointerEvent<HTMLElement>) => {
  if (e.button !== 0 || !inTauri) return;
  if ((e.target as HTMLElement).closest("button, a, input, select, textarea")) return;
  e.preventDefault();
  void getCurrentWindow().startDragging();
};

export const SettingsWindow = () => <SettingsDialog onClose={close} onReschedule={reschedule} onHeadDrag={drag} />;
