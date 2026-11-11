// Второй часовой пояс: дополнительная колонка часов в видах «Неделя» и «День»
import { createEvent, createStore } from "effector";
import { readJson, writeJson } from "../shared/lib/storage";
import { isTimeZone } from "../shared/lib/tz";

const KEY = "calm.secondZone";

/** выбранный пояс запоминается и когда колонка выключена */
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

/** пояс сменили в окне настроек — перечитываем сохранённый */
export const secondZoneReloaded = () => secondZoneChanged(parseSecondZone(readJson<unknown>(KEY, DEFAULT)));

/** пояс второй колонки; null — колонка выключена */
export const $secondZone = $secondZoneSetting.map((s) => (s.enabled ? s.zone : null));
