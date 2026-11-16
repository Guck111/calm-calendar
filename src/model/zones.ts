// Second time zone: an extra hours column in the "Week" and "Day" views
import { createEvent, createStore } from "effector";
import { readJson, writeJson } from "../shared/lib/storage";
import { isTimeZone } from "../shared/lib/tz";

const KEY = "calm.secondZone";

/** the chosen time zone is remembered even when the column is off */
export type SecondZone = { enabled: boolean; zone: string };

const DEFAULT: SecondZone = { enabled: false, zone: "UTC" };

export const parseSecondZone = (v: unknown): SecondZone => {
  const o = (v ?? {}) as Partial<SecondZone>;
  return { enabled: o.enabled === true, zone: isTimeZone(o.zone) ? o.zone : DEFAULT.zone };
};

export const secondZoneChanged = createEvent<Partial<SecondZone>>();

export const $secondZoneSetting = createStore<SecondZone>(parseSecondZone(readJson<unknown>(KEY, DEFAULT))).on(
  secondZoneChanged,
  (state, patch) => parseSecondZone({ ...state, ...patch }),
);

$secondZoneSetting.updates.watch((v) => writeJson(KEY, v));

/** the time zone was changed in the settings window — reload the saved one */
export const secondZoneReloaded = () => secondZoneChanged(parseSecondZone(readJson<unknown>(KEY, DEFAULT)));

/** time zone of the second column; null — the column is off */
export const $secondZone = $secondZoneSetting.map((s) => (s.enabled ? s.zone : null));
