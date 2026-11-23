// The four views as one button with a menu: takes the place of the tabs when the window is narrow.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { t } from "../shared/i18n";
import type { ViewMode } from "../shared/lib/date";
import { cx } from "./Button";
import { ChevronDown } from "./icons";
import s from "./ViewMenu.module.css";

type Props = {
  views: { id: ViewMode; key: string }[];
  value: ViewMode;
  onChange: (view: ViewMode) => void;
  className?: string;
};

export const ViewMenu = ({ views, value, onChange, className }: Props) => {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const items = () => [...(list.current?.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]") ?? [])];

  // the cursor starts on the current view
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLButtonElement>("[aria-checked=true]")?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) return;
    // the keys belong to the menu: the calendar's own arrows and letters stay out of it
    e.stopPropagation();
    if (e.key === "Escape") return close();
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    all[(at + step + all.length) % all.length]?.focus();
  };

  return (
    <div
      className={cx(s.root, className)}
      onKeyDown={onKeyDown}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}
    >
      <button
        ref={button}
        type="button"
        className={s.button}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t.toolbar.view}: ${t.toolbar.views[value]}`}
        onClick={() => setOpen(!open)}
      >
        {t.toolbar.views[value]}
        <ChevronDown />
      </button>
      {open && (
        <div ref={list} className={s.list} role="menu" aria-label={t.toolbar.view}>
          {views.map((v) => (
            <button
              key={v.id}
              type="button"
              role="menuitemradio"
              aria-checked={v.id === value}
              className={cx(s.item, v.id === value && s.current)}
              onClick={() => {
                onChange(v.id);
                close();
              }}
            >
              <span>{t.toolbar.views[v.id]}</span>
              <kbd className={s.key}>{v.key}</kbd>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
