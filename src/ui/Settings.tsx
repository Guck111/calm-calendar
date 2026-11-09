import { useEffect, useState } from "react";
import { LANGS, langName, readLangSetting, saveLangSetting, t, type LangSetting } from "../shared/i18n";
import { useUnit } from "effector-react";
import { reloadRequested } from "../model/events";
import { $secondZoneSetting, secondZoneChanged } from "../model/zones";
import { TimeZoneSelect } from "./TimeZoneSelect";
import { inTauri } from "../shared/api/bus";
import {
  glassSupported,
  initGlass,
  readSettings,
  setGlass,
  setNotifications,
  setAlerts,
  setPrivateNotifications,
  type AlertMode,
} from "../shared/lib/glass";
import { followTheme, readTheme, saveTheme, type Theme } from "../shared/lib/theme";
import { Button, cx } from "./Button";
import { Close, Gear } from "./icons";
import s from "./Settings.module.css";

const THEMES: Theme[] = ["system", "light", "dark"];
const ALERT_MODES: AlertMode[] = ["off", "calls", "all"];

const SettingsDialog = ({ onClose }: { onClose: () => void }) => {
  const [theme, setTheme] = useState(readTheme);
  const [language] = useState(readLangSetting);
  const [glass, setGlassState] = useState(false);
  const [notify, setNotify] = useState(false);
  const [privateNotify, setPrivateNotify] = useState(false);
  const [alerts, setAlertsState] = useState<AlertMode>("off");
  const [error, setError] = useState<string | null>(null);
  const reschedule = useUnit(reloadRequested);
  const [secondZone, changeSecondZone] = useUnit([$secondZoneSetting, secondZoneChanged]);

  useEffect(() => {
    void readSettings().then((st) => {
      setNotify(st.notifications);
      setPrivateNotify(st.private_notifications);
      setAlertsState(st.alerts);
    });
  }, []);

  const pickAlerts = async (mode: AlertMode) => {
    const previous = alerts;
    setAlertsState(mode);
    setError(null);
    try {
      await setAlerts(mode);
      if (mode !== "off") reschedule();
    } catch {
      setError(t.errors.settingFailed);
      setAlertsState(previous);
    }
  };

  const togglePrivate = async (enabled: boolean) => {
    setPrivateNotify(enabled);
    try {
      await setPrivateNotifications(enabled);
    } catch {
      setError(t.errors.settingFailed);
      setPrivateNotify(!enabled);
    }
  };

  const toggleNotify = async (enabled: boolean) => {
    setNotify(enabled);
    setError(null);
    try {
      await setNotifications(enabled);
      if (enabled) reschedule();
    } catch {
      setError(t.errors.notificationsFailed);
      setNotify(!enabled);
    }
  };

  useEffect(() => followTheme(setTheme), []);
  useEffect(() => initGlass(setGlassState), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pickTheme = (t: Theme) => {
    saveTheme(t);
    setTheme(t);
  };

  const toggleGlass = async (enabled: boolean) => {
    setGlassState(enabled);
    setError(null);
    try {
      await setGlass(enabled);
    } catch {
      setError(t.errors.glassFailed);
      setGlassState(!enabled);
    }
  };

  return (
    <div className={s.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={s.dialog} role="dialog" aria-modal="true" aria-label={t.common.settings}>
        <div className={s.head}>
          <h2>{t.common.settings}</h2>
          <Button variant="ghost" icon onClick={onClose} aria-label={t.common.close}>
            <Close />
          </Button>
        </div>

        <section className={s.section}>
          <h3>{t.settings.theme}</h3>
          <div className={s.segmented} role="radiogroup" aria-label={t.settings.theme}>
            {THEMES.map((id) => (
              <button
                key={id}
                role="radio"
                aria-checked={theme === id}
                className={cx(s.segment, theme === id && s.active)}
                onClick={() => pickTheme(id)}
              >
                {t.settings.themes[id]}
              </button>
            ))}
          </div>
        </section>

        <section className={s.section}>
          <h3>{t.settings.language}</h3>
          <select
            className={s.select}
            aria-label={t.settings.language}
            value={language}
            onChange={(e) => saveLangSetting(e.target.value as LangSetting)}
          >
            <option value="system">{t.settings.systemLanguage}</option>
            {LANGS.map((id) => (
              <option key={id} value={id} lang={id}>
                {langName(id)}
              </option>
            ))}
          </select>
        </section>

        <section className={s.section}>
          <label className={s.toggle}>
            <span>
              <b>{t.settings.secondZone}</b>
              <small>{t.settings.secondZoneText}</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={secondZone.enabled}
              onChange={(e) => changeSecondZone({ enabled: e.target.checked })}
            />
          </label>
          <TimeZoneSelect
            className={s.select}
            aria-label={t.settings.secondZone}
            value={secondZone.zone}
            disabled={!secondZone.enabled}
            onChange={(zone) => changeSecondZone({ zone })}
          />
        </section>

        <section className={s.section}>
          <label className={s.toggle}>
            <span>
              <b>{t.settings.glass}</b>
              <small>
                {t.settings.glassText} {glassSupported ? t.settings.glassPower : t.settings.glassWindowsOnly}
              </small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={glass}
              disabled={!glassSupported}
              onChange={(e) => void toggleGlass(e.target.checked)}
            />
          </label>
        </section>

        <section className={s.section}>
          <label className={s.toggle}>
            <span>
              <b>{t.settings.notifications}</b>
              <small>{t.settings.notificationsText}</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={notify}
              disabled={!inTauri}
              onChange={(e) => void toggleNotify(e.target.checked)}
            />
          </label>
          <label className={s.toggle}>
            <span>
              <b>{t.settings.privateNotifications}</b>
              <small>{t.settings.privateText}</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={privateNotify}
              disabled={!inTauri || !notify}
              onChange={(e) => void togglePrivate(e.target.checked)}
            />
          </label>
          {error && <p className={s.error}>{error}</p>}
        </section>

        <section className={s.section}>
          <h3>{t.alert.label}</h3>
          <select
            className={s.select}
            aria-label={t.alert.label}
            value={alerts}
            disabled={!inTauri}
            onChange={(e) => void pickAlerts(e.target.value as AlertMode)}
          >
            {ALERT_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {t.alert.modes[mode]}
              </option>
            ))}
          </select>
          <small className={s.sectionText}>{t.alert.text}</small>
        </section>

        <p className={s.hint}>{t.settings.trayHint}</p>
      </div>
    </div>
  );
};

export const SettingsButton = () => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" icon onClick={() => setOpen(true)} title={t.common.settings} aria-label={t.common.settings}>
        <Gear />
      </Button>
      {open && <SettingsDialog onClose={() => setOpen(false)} />}
    </>
  );
};
