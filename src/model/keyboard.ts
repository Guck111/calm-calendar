// Keys on a selected event block: Enter — card, E — edit, Ctrl+D — duplicate, Delete — delete.
// The DOM (focus) knows which block is selected; the event key and the action arrive here.
import { createEvent, sample } from "effector";
import type { CalendarEvent } from "../shared/api/types";
import { $events } from "./events";
import { deleteArmed, duplicateClicked, editClicked, eventOpened } from "./editor";

export type EventKeyAction = "open" | "edit" | "duplicate" | "delete";

export const eventKeyPressed = createEvent<{ key: string; action: EventKeyAction }>();

const found = sample({
  clock: eventKeyPressed,
  source: $events,
  fn: (events, { key, action }) => ({ event: events.find((e) => e.key === key), action }),
  filter: (events, { key }) => events.some((e) => e.key === key),
});

// first the card of this event: edit, duplicate and delete work with the open event
// (sample with target would return eventOpened itself, and the actions would fire on any click on an event)
sample({ clock: found, fn: ({ event }) => event as CalendarEvent, target: eventOpened });

sample({ clock: found, filter: ({ action }) => action === "edit", target: editClicked });
sample({ clock: found, filter: ({ action }) => action === "duplicate", target: duplicateClicked });
sample({ clock: found, filter: ({ action }) => action === "delete", target: deleteArmed });
