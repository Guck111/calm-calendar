// Window with all keyboard shortcuts: "?" anywhere except an input field, or a command in the Ctrl+K menu.
import { useUnit } from "effector-react";
import { Fragment, useEffect, useState } from "react";
import { t } from "../shared/i18n";
import { shortcutsRequested } from "../model/shortcuts";
import { DEFAULT_QUICK_HOTKEY } from "../shared/lib/hotkeys";
import { readSettings } from "../shared/lib/glass";
import { shortcutGroups } from "../shared/lib/shortcuts";
import { Button } from "./Button";
import { Close } from "./icons";
import p from "./Popup.module.css";
import k from "./Shortcuts.module.css";

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

const ShortcutsDialog = ({ onClose }: { onClose: () => void }) => {
  const [hotkey, setHotkey] = useState<string | null>(DEFAULT_QUICK_HOTKEY);
  useEffect(() => void readSettings().then((st) => setHotkey(st.quick_hotkey)), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className={p.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`${p.dialog} ${k.dialog}`} role="dialog" aria-modal="true" aria-label={t.shortcuts.title}>
        <div className={p.head}>
          <h2>{t.shortcuts.title}</h2>
          <Button variant="ghost" icon onClick={onClose} aria-label={t.common.close} autoFocus>
            <Close />
          </Button>
        </div>
        <div className={k.groups}>
          {shortcutGroups(hotkey).map((group) => (
            <section key={group.title} className={k.group}>
              <h3>{group.title}</h3>
              <dl className={k.list}>
                {group.items.map((item) => (
                  <Fragment key={item.label}>
                    <dt>{item.label}</dt>
                    <dd>
                      {item.keys.map((combo, i) => (
                        <span key={i} className={k.combo}>
                          {combo.map((key) => (
                            <kbd key={key}>{key}</kbd>
                          ))}
                        </span>
                      ))}
                    </dd>
                  </Fragment>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
};

export const Shortcuts = () => {
  const [open, setOpen] = useState(false);
  const request = useUnit(shortcutsRequested);
  useEffect(() => shortcutsRequested.watch(() => setOpen(true)), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      // "?" is Shift+/ on the English layout, Shift+7 on the Russian one; e.key is the same
      if (e.key !== "?" && !(e.code === "Slash" && e.shiftKey)) return;
      // not opened on top of another window (card, form, menu)
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      request();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request]);
  return open ? <ShortcutsDialog onClose={() => setOpen(false)} /> : null;
};
