// A calm card asking for a rating in Microsoft Store: once, two weeks after the first day the app was used,
// in the Store build only. "Rate" opens the Store dialog, "Not now" closes it; neither asks again.
import { combine, createEffect, createEvent, createStore, sample } from "effector";
import { isStoreBuild, requestStoreRating } from "../shared/api/store";
import { daysBetween, fromDateKey, toDateKey } from "../shared/lib/date";
import { logError } from "../shared/lib/log";
import { readJson, writeJson } from "../shared/lib/storage";
import { appStarted } from "./auth";
import { $today } from "./view";
import { $welcomeOpen } from "./welcome";

const KEY = "calm.rating";
const WAIT_DAYS = 14;

/** since: the first day the app was used ("2026-11-23"); answered: Rate or Not now was chosen */
export type RatingState = { since: string; answered: boolean };

export const ratingDue = ({ since, answered }: RatingState, today: Date): boolean =>
  !answered && daysBetween(fromDateKey(since), today) >= WAIT_DAYS;

const isState = (v: unknown): v is RatingState =>
  typeof v === "object" && v !== null && typeof (v as RatingState).since === "string" && typeof (v as RatingState).answered === "boolean";

const stored = readJson<unknown>(KEY, null);

export const rateClicked = createEvent();
export const rateDeclined = createEvent();

export const checkStoreFx = createEffect(isStoreBuild);
export const requestRatingFx = createEffect(requestStoreRating);

export const $ratingState = createStore<RatingState>(
  isState(stored) ? stored : { since: toDateKey(new Date()), answered: false },
).on([rateClicked, rateDeclined], (state) => ({ ...state, answered: true }));

$ratingState.watch((state) => writeJson(KEY, state));

const $storeBuild = createStore(false).on(checkStoreFx.doneData, (_, yes) => yes);

export const $ratingOpen = combine(
  $ratingState,
  $today,
  $storeBuild,
  $welcomeOpen,
  (state, today, storeBuild, welcomeOpen) => storeBuild && !welcomeOpen && ratingDue(state, today),
);

sample({ clock: appStarted, target: checkStoreFx });
sample({ clock: rateClicked, target: requestRatingFx });

requestRatingFx.failData.watch((e) => logError("store rating failed", e));
