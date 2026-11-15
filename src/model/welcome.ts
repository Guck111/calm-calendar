// Карточка «Что ещё умеет Calm Calendar»: один раз после первого входа, потом — из меню Ctrl+K
import { createEvent, createStore } from "effector";
import { readJson, writeJson } from "../shared/lib/storage";

const KEY = "calm.welcome";

/** Ctrl+K → «Что умеет Calm Calendar» */
export const welcomeRequested = createEvent();
/** «Готово» или Esc: больше сама не появится */
export const welcomeClosed = createEvent();

export const $welcomeOpen = createStore<boolean>(!readJson<boolean>(KEY, false))
  .on(welcomeRequested, () => true)
  .on(welcomeClosed, () => false);

welcomeClosed.watch(() => writeJson(KEY, true));
