import {
  useEffect,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { LANGS, langName, readLangSetting, saveLangSetting, t, type LangSetting } from "../shared/i18n";
import { useUnit } from "effector-react";
import { $secondZoneSetting, secondZoneChanged } from "../model/zones";
import { $feeds, $holidayRegion, $weekNumbers, feedAdded, feedRemoved, holidayRegionChanged, weekNumbersToggled } from "../model/display";
import { downloadFeed, dropFeedCache } from "../shared/api/feeds";
import { looksLikeUrl, sameFeedUrl, type Feed } from "../shared/lib/feeds";
import { createChangeTracker } from "../shared/lib/changes";
import { sortedRegions } from "../shared/lib/holidays";
import { TimeZoneSelect } from "./TimeZoneSelect";
import { broadcast, inTauri } from "../shared/api/bus";
import {
  glassSupported,
  initGlass,
  readDesktop,
  readSettings,
  setAutostart,
  setWidget,
  type DesktopState,
  setGlass,
  setNotifications,
  setAlerts,
  setPrivateNotifications,
  setQuickHotkey,
  type AlertMode,
} from "../shared/lib/glass";
import { DEFAULT_QUICK_HOTKEY, QUICK_HOTKEYS, hotkeyLabel } from "../shared/lib/hotkeys";
import { followTheme, readTheme, saveTheme, type Theme } from "../shared/lib/theme";
import {
  DISPLAY_FONTS,
  FONT_NAMES,
  STYLES,
  STYLE_FONTS,
  TEXT_FONTS,
  fontStack,
  followAppearance,
  readAppearance,
  saveAppearance,
  type Appearance,
  type FontChoice,
  type FontId,
} from "../shared/lib/appearance";
import { Button, cx } from "./Button";
import { openLogsFolder } from "../shared/lib/log";
import { Bell, Bolt, CalendarDays, Close, Contrast, Help } from "./icons";
import { useDraggable } from "./useDraggable";
import s from "./Settings.module.css";

const THEMES: Theme[] = ["system", "light", "dark"];
const ALERT_MODES: AlertMode[] = ["off", "calls", "all"];
/** Sections of the settings: the list at the start edge, one of them open next to it */
const SECTIONS = ["look", "calendar", "reminders", "quick", "help"] as const;
type SectionId = (typeof SECTIONS)[number];

const SECTION_ICON: Record<SectionId, typeof Help> = {
  look: Contrast,
  calendar: CalendarDays,
  reminders: Bell,
  quick: Bolt,
  help: Help,
};

const sectionName = (id: SectionId): string =>
  ({
    look: t.settings.groupLook,
    calendar: t.settings.groupCalendar,
    reminders: t.settings.groupReminders,
    quick: t.settings.groupQuick,
    help: t.settings.groupHelp,
  })[id];

/** Help has only the log folder, and that needs the app */
const shownSections = (): SectionId[] => SECTIONS.filter((id) => id !== "help" || inTauri);

/** Options of one section. A closed one stays mounted, so what was typed in it is kept */
const Pane = ({ id, current, children }: { id: SectionId; current: SectionId; children: ReactNode }) => (
  <div
    id={`settings-panel-${id}`}
    className={s.group}
    role="tabpanel"
    aria-labelledby={`settings-tab-${id}`}
    hidden={id !== current}
  >
    <h3 className={s.groupTitle}>{sectionName(id)}</h3>
    {children}
  </div>
);

/** list value for a disabled hotkey */
const OFF = "off";

/** font list: the style font first, each font shown in itself */
const FontSelect = ({
  label,
  value,
  fonts,
  styleFont,
  onChange,
}: {
  label: string;
  value: FontChoice;
  fonts: readonly FontId[];
  styleFont: FontId;
  onChange: (v: FontChoice) => void;
}) => (
  <label className={s.field}>
    <span>{label}</span>
    <select
      className={s.select}
      value={value}
      style={{ fontFamily: fontStack(value === "auto" ? styleFont : value) }}
      onChange={(e) => onChange(e.target.value as FontChoice)}
    >
      <option value="auto" style={{ fontFamily: fontStack(styleFont) }}>
        {t.settings.fontAuto(FONT_NAMES[styleFont])}
      </option>
      {fonts.map((id) => (
        <option key={id} value={id} style={{ fontFamily: fontStack(id) }}>
          {FONT_NAMES[id]}
        </option>
      ))}
    </select>
  </label>
);

type Props = {
  onClose: () => void;
  /** reminders turned on — reload events and reschedule them */
  onReschedule: () => void;
  /** in a separate window: no dimming, the window is dragged by the header using Windows */
  onHeadDrag?: (e: ReactPointerEvent<HTMLElement>) => void;
};

/** settings written through Rust, one change counter each */
type SettingKey = "widget" | "on_top" | "autostart" | "hotkey" | "alerts" | "private" | "notify";

/** second time zone, week numbers, holidays are stored in the calendar window: tell it about the change */
const displayChanged = () => broadcast("display-changed");

/** .ics calendar subscriptions: the link is checked by downloading, the name comes from the calendar itself */
const FeedsSection = () => {
  const [feeds, addFeed, removeFeed] = useUnit([$feeds, feedAdded, feedRemoved]);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const link = url.trim();
    if (!link) return;
    if (!looksLikeUrl(link)) return setError(t.settings.feedFailed);
    if (feeds.some((f) => sameFeedUrl(f.url, link))) return setError(t.settings.feedExists);
    setBusy(true);
    setError(null);
    try {
      const cal = await downloadFeed(link);
      // subscriptions may have been removed while it downloaded: the model adds to the list as it is now
      addFeed({ url: link, name: cal.name ?? "" });
      displayChanged();
      setUrl("");
    } catch (err) {
      const notIcs = (err as { message?: string } | null)?.message === t.settings.feedNotIcs;
      setError(notIcs ? t.settings.feedNotIcs : t.settings.feedFailed);
    } finally {
      setBusy(false);
    }
  };

  const remove = (feed: Feed) => {
    removeFeed(feed.id);
    dropFeedCache(feed.id);
    displayChanged();
  };

  return (
    <section className={s.section}>
      <h4>{t.settings.feeds}</h4>
      <small className={s.hint}>{t.settings.feedsText}</small>
      {feeds.length > 0 && (
        <ul className={s.feeds}>
          {feeds.map((f) => (
            <li key={f.id} className={s.feed}>
              <i className={s.feedDot} style={{ background: f.color }} />
              <span className={s.feedName} title={f.url}>
                {f.name}
              </span>
              <Button variant="ghost" icon onClick={() => remove(f)} aria-label={t.settings.feedRemove(f.name)} title={t.settings.feedRemove(f.name)}>
                <Close />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form className={s.feedForm} onSubmit={(e) => void add(e)}>
        <input
          className={s.select}
          type="url"
          inputMode="url"
          placeholder="https://… .ics"
          aria-label={t.settings.feedUrl}
          value={url}
          disabled={busy}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
        />
        <Button type="submit" disabled={busy || !url.trim()}>
          {t.settings.feedAdd}
        </Button>
      </form>
      {error && <p className={s.error}>{error}</p>}
    </section>
  );
};

export const SettingsDialog = ({ onClose, onReschedule, onHeadDrag }: Props) => {
  const standalone = !!onHeadDrag;
  const drag = useDraggable<HTMLDivElement>();
  const [theme, setTheme] = useState(readTheme);
  const [appearance, setAppearance] = useState(readAppearance);
  const [language] = useState(readLangSetting);
  const [glass, setGlassState] = useState(false);
  const [notify, setNotify] = useState(false);
  const [privateNotify, setPrivateNotify] = useState(false);
  const [alerts, setAlertsState] = useState<AlertMode>("off");
  const [hotkey, setHotkeyState] = useState<string>(DEFAULT_QUICK_HOTKEY);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  // widget, always on top and autostart — the same as in the tray menu; the checkboxes there follow
  const [desktop, setDesktop] = useState<DesktopState>({ widget: false, on_top: false, autostart: false });
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<SectionId>("look");
  const [sections] = useState(shownSections);
  const openSection = (id: SectionId) => {
    setSection(id);
    setError(null);
  };
  // up and down move along the list and open the section at once
  const onSectionKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = sections[(sections.indexOf(section) + step + sections.length) % sections.length];
    openSection(next);
    e.currentTarget.querySelector<HTMLElement>(`#settings-tab-${next}`)?.focus();
  };
  const reschedule = onReschedule;
  const [secondZone, setSecondZone] = useUnit([$secondZoneSetting, secondZoneChanged]);
  const [weekNumbers, setWeekNumbers, holidayRegion, setHolidays] = useUnit([
    $weekNumbers,
    weekNumbersToggled,
    $holidayRegion,
    holidayRegionChanged,
  ]);
  const changeSecondZone = (patch: Parameters<typeof setSecondZone>[0]) => {
    setSecondZone(patch);
    displayChanged();
  };
  const toggleWeekNumbers = (v: boolean) => {
    setWeekNumbers(v);
    displayChanged();
  };
  const changeHolidays = (v: string | null) => {
    setHolidays(v);
    displayChanged();
  };
  // countries in the app language's alphabetical order
  const [regions] = useState(sortedRegions);

  // the late failure of an earlier change must not roll back a newer one, the first read — overwrite a change
  const [changes] = useState(() => createChangeTracker<SettingKey>());
  const changeStarted = changes.start;
  const untouched = changes.untouched;

  useEffect(() => {
    void readDesktop().then((read) =>
      setDesktop((d) => ({
        widget: untouched("widget") ? read.widget : d.widget,
        on_top: untouched("on_top") ? read.on_top : d.on_top,
        autostart: untouched("autostart") ? read.autostart : d.autostart,
      })),
    );
  }, []);

  const toggleWidget = async (visible: boolean) => {
    const isLatest = changeStarted("widget");
    setDesktop((d) => ({ ...d, widget: visible }));
    try {
      await setWidget({ visible });
    } catch {
      if (!isLatest()) return;
      setDesktop((d) => ({ ...d, widget: !visible }));
      setError(t.errors.settingFailed);
    }
  };
  const toggleOnTop = async (onTop: boolean) => {
    const isLatest = changeStarted("on_top");
    setDesktop((d) => ({ ...d, on_top: onTop }));
    try {
      await setWidget({ onTop });
    } catch {
      if (!isLatest()) return;
      setDesktop((d) => ({ ...d, on_top: !onTop }));
      setError(t.errors.settingFailed);
    }
  };
  // autostart can be disabled in Task Manager: the toggle shows what actually happened
  const toggleAutostart = async (enabled: boolean) => {
    const isLatest = changeStarted("autostart");
    setDesktop((d) => ({ ...d, autostart: enabled }));
    try {
      const actual = await setAutostart(enabled);
      if (isLatest()) setDesktop((d) => ({ ...d, autostart: actual }));
    } catch {
      if (!isLatest()) return;
      setDesktop((d) => ({ ...d, autostart: !enabled }));
      setError(t.errors.settingFailed);
    }
  };

  useEffect(() => {
    void readSettings().then((st) => {
      if (untouched("notify")) setNotify(st.notifications);
      if (untouched("private")) setPrivateNotify(st.private_notifications);
      if (untouched("alerts")) setAlertsState(st.alerts);
      if (untouched("hotkey")) setHotkeyState(st.quick_hotkey ?? OFF);
    });
  }, []);

  const pickHotkey = async (value: string) => {
    const isLatest = changeStarted("hotkey");
    const previous = hotkey;
    setHotkeyState(value);
    setHotkeyError(null);
    try {
      await setQuickHotkey(value === OFF ? null : value);
    } catch {
      if (!isLatest()) return;
      setHotkeyError(t.settings.hotkeyBusy);
      setHotkeyState(previous);
    }
  };

  const pickAlerts = async (mode: AlertMode) => {
    const isLatest = changeStarted("alerts");
    const previous = alerts;
    setAlertsState(mode);
    setError(null);
    try {
      await setAlerts(mode);
      if (mode !== "off") reschedule();
    } catch {
      if (!isLatest()) return;
      setError(t.errors.settingFailed);
      setAlertsState(previous);
    }
  };

  const togglePrivate = async (enabled: boolean) => {
    const isLatest = changeStarted("private");
    setPrivateNotify(enabled);
    try {
      await setPrivateNotifications(enabled);
    } catch {
      if (!isLatest()) return;
      setError(t.errors.settingFailed);
      setPrivateNotify(!enabled);
    }
  };

  const toggleNotify = async (enabled: boolean) => {
    const isLatest = changeStarted("notify");
    setNotify(enabled);
    setError(null);
    try {
      await setNotifications(enabled);
      if (enabled) reschedule();
    } catch {
      if (!isLatest()) return;
      setError(t.errors.notificationsFailed);
      setNotify(!enabled);
    }
  };

  useEffect(() => followTheme(setTheme), []);
  useEffect(() => followAppearance(setAppearance), []);
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

  const changeAppearance = (patch: Partial<Appearance>) => {
    const next = { ...appearance, ...patch };
    saveAppearance(next);
    setAppearance(next);
  };
  const styleFonts = STYLE_FONTS[appearance.style];

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
    <div
      className={standalone ? s.window : s.backdrop}
      onMouseDown={(e) => !standalone && e.target === e.currentTarget && onClose()}
    >
      <div
        ref={drag.ref}
        style={standalone ? undefined : drag.style}
        className={s.dialog}
        role="dialog"
        aria-modal={!standalone}
        aria-label={t.common.settings}
      >
        <div className={s.head} {...(standalone ? { onPointerDown: onHeadDrag } : drag.handleProps)}>
          <h2>{t.common.settings}</h2>
          <Button variant="ghost" icon onClick={onClose} aria-label={t.common.close}>
            <Close />
          </Button>
        </div>

        <div className={s.body}>
          <div
            className={s.nav}
            role="tablist"
            aria-orientation="vertical"
            aria-label={t.common.settings}
            onKeyDown={onSectionKey}
          >
            {sections.map((id) => {
              const Icon = SECTION_ICON[id];
              return (
                <button
                  key={id}
                  id={`settings-tab-${id}`}
                  type="button"
                  role="tab"
                  aria-selected={section === id}
                  aria-controls={`settings-panel-${id}`}
                  tabIndex={section === id ? 0 : -1}
                  className={cx(s.navItem, section === id && s.navActive)}
                  onClick={() => openSection(id)}
                >
                  <Icon />
                  <span>{sectionName(id)}</span>
                </button>
              );
            })}
          </div>

          <div className={s.content}>
          <Pane id="look" current={section}>
          <section className={s.section}>
            <h4>{t.settings.theme}</h4>
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
            <h4>{t.settings.style}</h4>
            <div className={s.styles} role="radiogroup" aria-label={t.settings.style}>
              {STYLES.map((id) => (
                <button
                  key={id}
                  role="radio"
                  aria-checked={appearance.style === id}
                  className={cx(s.styleCard, appearance.style === id && s.styleActive)}
                  onClick={() => changeAppearance({ style: id })}
                >
                  {/* style sample: the same variables as a window in this style (styles.css) */}
                  <span className={s.preview} data-style-preview={id} aria-hidden>
                    <span className={s.previewAa}>Aa</span>
                    <span className={s.previewToday} />
                    <span className={s.previewEvent} />
                  </span>
                  <span className={s.styleName}>{t.settings.styles[id]}</span>
                </button>
              ))}
            </div>
            <div className={s.fonts}>
              <FontSelect
                label={t.settings.displayFont}
                value={appearance.display}
                fonts={DISPLAY_FONTS}
                styleFont={styleFonts.display}
                onChange={(display) => changeAppearance({ display })}
              />
              <FontSelect
                label={t.settings.textFont}
                value={appearance.text}
                fonts={TEXT_FONTS}
                styleFont={styleFonts.text}
                onChange={(text) => changeAppearance({ text })}
              />
            </div>
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
          </Pane>

          <Pane id="calendar" current={section}>
          <section className={s.section}>
            <h4>{t.settings.language}</h4>
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
                <b>{t.settings.weekNumbers}</b>
                <small>{t.settings.weekNumbersText}</small>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={weekNumbers}
                onChange={(e) => toggleWeekNumbers(e.target.checked)}
              />
            </label>
          </section>

          <section className={s.section}>
            <h4>{t.settings.holidays}</h4>
            <small className={s.hint}>{t.settings.holidaysText}</small>
            <select
              className={s.select}
              aria-label={t.settings.holidays}
              value={holidayRegion ?? ""}
              onChange={(e) => changeHolidays(e.target.value || null)}
            >
              <option value="">{t.settings.holidaysNone}</option>
              {regions.map((r) => (
                <option key={r.region} value={r.region}>
                  {r.name}
                </option>
              ))}
            </select>
          </section>

          <FeedsSection />
          </Pane>

          <Pane id="reminders" current={section}>
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
          </section>

          <section className={s.section}>
            <h4>{t.alert.label}</h4>
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
          </Pane>

          <Pane id="quick" current={section}>
          <section className={s.section}>
            <h4>{t.settings.quickHotkey}</h4>
            <select
              className={s.select}
              aria-label={t.settings.quickHotkey}
              value={hotkey}
              disabled={!inTauri}
              onChange={(e) => void pickHotkey(e.target.value)}
            >
              <option value={OFF}>{t.settings.hotkeyOff}</option>
              {QUICK_HOTKEYS.map((h) => (
                <option key={h} value={h}>
                  {hotkeyLabel(h)}
                </option>
              ))}
            </select>
            <small className={s.sectionText}>{t.settings.quickHotkeyText}</small>
            {hotkeyError && <p className={s.error}>{hotkeyError}</p>}
          </section>

          <section className={s.section}>
            <label className={s.toggle}>
              <span>
                <b>{t.welcome.widget}</b>
                <small>{t.welcome.widgetHint}</small>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={desktop.widget}
                disabled={!inTauri}
                onChange={(e) => void toggleWidget(e.target.checked)}
              />
            </label>
          </section>

          <section className={s.section}>
            <label className={s.toggle}>
              <span>
                <b>{t.settings.onTop}</b>
                <small>{t.settings.onTopText}</small>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={desktop.on_top}
                disabled={!inTauri}
                onChange={(e) => void toggleOnTop(e.target.checked)}
              />
            </label>
          </section>

          <section className={s.section}>
            <label className={s.toggle}>
              <span>
                <b>{t.welcome.autostart}</b>
                <small>{t.welcome.autostartHint}</small>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={desktop.autostart}
                disabled={!inTauri}
                onChange={(e) => void toggleAutostart(e.target.checked)}
              />
            </label>
          </section>
          <p className={s.hint}>{t.settings.trayHint}</p>
          </Pane>

          {sections.includes("help") && (
            <Pane id="help" current={section}>
            <section className={s.section}>
              <h4>{t.settings.logs}</h4>
              <small className={s.sectionText}>{t.settings.logsText}</small>
              <div>
                <Button onClick={() => void openLogsFolder().catch(() => setError(t.errors.settingFailed))}>
                  {t.settings.openLogs}
                </Button>
              </div>
            </section>
            </Pane>
          )}

          {error && <p className={s.error}>{error}</p>}
          </div>
        </div>
      </div>
    </div>
  );
};
