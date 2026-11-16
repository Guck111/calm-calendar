import { useUnit } from "effector-react";
import { useEffect, useRef, useState } from "react";
import { $welcomeOpen, welcomeClosed } from "../model/welcome";
import { inTauri } from "../shared/api/bus";
import { t } from "../shared/i18n";
import { readDesktop, readSettings, setAlerts, setAutostart, setWidget, type AlertMode } from "../shared/lib/glass";
import { hotkeyLabel } from "../shared/lib/hotkeys";
import { Button } from "./Button";
import { Close } from "./icons";
import s from "./Welcome.module.css";

type Toggle = { name: string; hint: string; on: boolean; set: (on: boolean) => void };

const Row = ({ name, hint, on, set }: Toggle) => (
  <label className={s.toggle}>
    <span>
      <b>{name}</b>
      <small>{hint}</small>
    </span>
    {/* виджет, автозапуск и напоминание живут в приложении; в браузере переключать нечего */}
    <input type="checkbox" role="switch" checked={on} disabled={!inTauri} onChange={(e) => set(e.target.checked)} />
  </label>
);

/** «Что ещё умеет Calm Calendar»: после первого входа, сбоку внизу, не забирая фокус и не закрывая календарь.
 *  Самое полезное, что иначе прячется в меню трея и в настройках, — с переключателями прямо здесь */
export const Welcome = () => {
  const [open, close] = useUnit([$welcomeOpen, welcomeClosed]);
  const [widget, setWidgetState] = useState(false);
  const [autostart, setAutostartState] = useState(false);
  const [alerts, setAlertsState] = useState<AlertMode>("off");
  const [hotkey, setHotkey] = useState<string | null>(null);
  const card = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    void readDesktop().then((d) => {
      setWidgetState(d.widget);
      setAutostartState(d.autostart);
    });
    void readSettings().then((st) => {
      setAlertsState(st.alerts);
      setHotkey(st.quick_hotkey);
    });
  }, [open]);

  // Esc закрывает карточку, только когда фокус в ней: иначе Esc нужен календарю
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && card.current?.contains(document.activeElement)) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  const toggleWidget = (on: boolean) => {
    setWidgetState(on);
    void setWidget({ visible: on }).catch(() => setWidgetState(!on));
  };
  const toggleAutostart = (on: boolean) => {
    setAutostartState(on);
    void setAutostart(on).then(setAutostartState, () => setAutostartState(!on));
  };
  // «все события» тоже считаются включённым; выключатель здесь — «только звонки» или «выключено»
  const toggleAlert = (on: boolean) => {
    const previous = alerts;
    const mode: AlertMode = on ? "calls" : "off";
    setAlertsState(mode);
    void setAlerts(mode).catch(() => setAlertsState(previous));
  };

  return (
    // немодальная панель сбоку, а не диалог: календарь рядом работает, фокус она не забирает
    <aside ref={card} className={s.card} aria-labelledby="welcome-title">
      <div className={s.head}>
        <h2 id="welcome-title" className={s.title}>
          {t.welcome.title}
        </h2>
        <Button variant="ghost" icon onClick={() => close()} aria-label={t.common.close}>
          <Close size={14} />
        </Button>
      </div>
      <p className={s.intro}>{t.welcome.intro}</p>

      <Row name={t.welcome.widget} hint={t.welcome.widgetHint} on={widget} set={toggleWidget} />
      <Row name={t.welcome.autostart} hint={t.welcome.autostartHint} on={autostart} set={toggleAutostart} />
      <Row name={t.welcome.alert} hint={t.welcome.alertHint} on={alerts !== "off"} set={toggleAlert} />

      {hotkey && (
        <p className={s.tip}>
          <b>{t.welcome.hotkey}</b>
          <small>{t.welcome.hotkeyHint(hotkeyLabel(hotkey))}</small>
        </p>
      )}
      <p className={s.tip}>
        <b>{t.welcome.tray}</b>
        <small>{t.welcome.trayHint}</small>
      </p>

      <div className={s.actions}>
        <Button variant="primary" onClick={() => close()}>
          {t.welcome.done}
        </Button>
      </div>
    </aside>
  );
};
