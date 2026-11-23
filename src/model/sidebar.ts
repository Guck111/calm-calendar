// The side panel (create, quick add, mini month, calendars). In a wide window its button hides it and the choice
// is remembered; in a narrow one it is hidden and the button pulls it out over the calendar.
import { createEvent, createStore } from "effector";
import { readJson, writeJson } from "../shared/lib/storage";
import { quickFocusRequested } from "./quick";

const PINNED_KEY = "calm.sidebar";
/** below this the period title would not fit next to the panel */
const NARROW = "(max-width: 960px)";

export const sidebarToggled = createEvent();
/** Esc or a click outside the pulled-out panel */
export const sidebarClosed = createEvent();
export const narrowChanged = createEvent<boolean>();

const media = typeof window === "undefined" ? null : window.matchMedia(NARROW);
media?.addEventListener("change", (e) => narrowChanged(e.matches));

type State = { narrow: boolean; pinned: boolean; pulledOut: boolean };

const $state = createStore<State>({
  narrow: media?.matches ?? false,
  pinned: readJson<unknown>(PINNED_KEY, true) !== false,
  pulledOut: false,
})
  .on(narrowChanged, (s, narrow) => ({ ...s, narrow, pulledOut: false }))
  .on(sidebarToggled, (s) => (s.narrow ? { ...s, pulledOut: !s.pulledOut } : { ...s, pinned: !s.pinned }))
  .on(sidebarClosed, (s) => ({ ...s, pulledOut: false }))
  // the quick add field lives in the panel
  .on(quickFocusRequested, (s) => (s.narrow ? { ...s, pulledOut: true } : { ...s, pinned: true }));

$state.map((s) => s.pinned).watch((pinned) => writeJson(PINNED_KEY, pinned));

/** shown: the panel is on screen; over: it lies over the calendar instead of standing beside it */
export const $sidebar = $state.map(({ narrow, pinned, pulledOut }) => ({
  shown: narrow ? pulledOut : pinned,
  over: narrow,
}));
