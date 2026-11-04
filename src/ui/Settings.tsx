import { useEffect, useState } from "react";
import { glassSupported, initGlass, setGlass } from "../shared/lib/glass";
import { followTheme, readTheme, saveTheme, type Theme } from "../shared/lib/theme";
import { Button, cx } from "./Button";
import { Close, Gear } from "./icons";
import s from "./Settings.module.css";

const THEMES: { id: Theme; label: string }[] = [
  { id: "system", label: "Как в системе" },
  { id: "light", label: "Светлая" },
  { id: "dark", label: "Тёмная" },
];

const SettingsDialog = ({ onClose }: { onClose: () => void }) => {
  const [theme, setTheme] = useState(readTheme);
  const [glass, setGlassState] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError("Не удалось переключить эффект стекла");
      setGlassState(!enabled);
    }
  };

  return (
    <div className={s.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={s.dialog} role="dialog" aria-modal="true" aria-label="Настройки">
        <div className={s.head}>
          <h2>Настройки</h2>
          <Button variant="ghost" icon onClick={onClose} aria-label="Закрыть">
            <Close />
          </Button>
        </div>

        <section className={s.section}>
          <h3>Тема</h3>
          <div className={s.segmented} role="radiogroup" aria-label="Тема">
            {THEMES.map((t) => (
              <button
                key={t.id}
                role="radio"
                aria-checked={theme === t.id}
                className={cx(s.segment, theme === t.id && s.active)}
                onClick={() => pickTheme(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </section>

        <section className={s.section}>
          <label className={s.toggle}>
            <span>
              <b>Эффект стекла</b>
              <small>
                Календарь и виджет становятся полупрозрачными, а то, что под ними, — размытым.
                {glassSupported ? " Windows может отключить размытие в режиме экономии энергии." : " Работает только в Windows."}
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
          {error && <p className={s.error}>{error}</p>}
        </section>

        <p className={s.hint}>Виджет, «поверх окон» и автозапуск — в меню значка в трее.</p>
      </div>
    </div>
  );
};

export const SettingsButton = () => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" icon onClick={() => setOpen(true)} title="Настройки" aria-label="Настройки">
        <Gear />
      </Button>
      {open && <SettingsDialog onClose={() => setOpen(false)} />}
    </>
  );
};
