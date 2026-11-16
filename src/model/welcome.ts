// "What else Calm Calendar can do" card: once after the first sign-in, then from the Ctrl+K menu
import { createEvent, createStore } from "effector";
import { readJson, writeJson } from "../shared/lib/storage";

const KEY = "calm.welcome";

/** Ctrl+K → "What Calm Calendar can do" */
export const welcomeRequested = createEvent();
/** "Done" or Esc: it won't show up by itself again */
export const welcomeClosed = createEvent();

export const $welcomeOpen = createStore<boolean>(!readJson<boolean>(KEY, false))
  .on(welcomeRequested, () => true)
  .on(welcomeClosed, () => false);

welcomeClosed.watch(() => writeJson(KEY, true));
