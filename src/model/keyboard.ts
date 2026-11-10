// Клавиши на выбранном блоке события: Enter — карточка, E — правка, Ctrl+D — копия, Delete — удалить.
// Какой блок выбран, знает DOM (фокус); сюда приходит ключ события и действие.
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

// сначала карточка этого события: правка, копия и удаление работают с открытым событием
// (sample с target вернул бы сам eventOpened, и действия срабатывали бы на любой клик по событию)
sample({ clock: found, fn: ({ event }) => event as CalendarEvent, target: eventOpened });

sample({ clock: found, filter: ({ action }) => action === "edit", target: editClicked });
sample({ clock: found, filter: ({ action }) => action === "duplicate", target: duplicateClicked });
sample({ clock: found, filter: ({ action }) => action === "delete", target: deleteArmed });
