import { createEffect, createEvent, sample } from "effector";
import { broadcast } from "../shared/api/bus";
import { saveEvent } from "../shared/api/calendar";
import type { AppError, EventDraft } from "../shared/api/types";
import { sessionLost } from "./auth";
import { reloadRequested } from "./events";

/** клавиша N: перевести курсор в строку быстрого создания */
export const quickFocusRequested = createEvent();

export const quickCreateFx = createEffect<EventDraft, void, AppError>(saveEvent);

sample({ clock: quickCreateFx.done, target: reloadRequested });
quickCreateFx.done.watch(() => broadcast("events-changed", { from: "main" }));

sample({
  clock: quickCreateFx.failData,
  filter: (e) => e.kind === "not_signed_in",
  target: sessionLost,
});
