import { useUnit } from "effector-react";
import { useEffect, useState } from "react";
import { locale, t } from "../shared/i18n";
import { $events, $loadError, $loading } from "../model/events";
import { freeSlotsRequested } from "../model/free";
import { $cursor, $now, $view, nextClicked } from "../model/view";
import { toTimeKey, viewDays } from "../shared/lib/date";
import { formatFreeSlots, freeSlots, type FreeOptions } from "../shared/lib/free";
import { readJson, writeJson } from "../shared/lib/storage";
import { copyText } from "../shared/lib/clipboard";
import { Button } from "./Button";
import { Clock, Close } from "./icons";
import s from "./Settings.module.css";
import p from "./Popup.module.css";
import f from "./FreeSlots.module.css";

const KEY = "calm.freeSlots";
const DEFAULT: FreeOptions = { from: 9 * 60, to: 18 * 60, minLength: 30, weekends: false };
const LENGTHS = [15, 30, 60, 90, 120];

const readOptions = (): FreeOptions => {
  const o = readJson<Partial<FreeOptions>>(KEY, DEFAULT);
  const minutes = (v: unknown, d: number) => (typeof v === "number" && v >= 0 && v <= 24 * 60 ? v : d);
  const from = minutes(o.from, DEFAULT.from);
  const to = minutes(o.to, DEFAULT.to);
  return {
    from: from < to ? from : DEFAULT.from,
    to: from < to ? to : DEFAULT.to,
    minLength: LENGTHS.includes(o.minLength as number) ? (o.minLength as number) : DEFAULT.minLength,
    weekends: o.weekends === true,
  };
};

/** «09:30» → 570 */
const minutesOf = (key: string): number => {
  const [h, m] = key.split(":").map(Number);
  return h * 60 + m;
};
const timeKeyOf = (minutes: number): string => toTimeKey(new Date(2000, 0, 1, 0, minutes));

const FreeSlotsDialog = ({ onClose }: { onClose: () => void }) => {
  const [events, view, cursor, now, next, loading] = useUnit([$events, $view, $cursor, $now, nextClicked, $loading]);
  const loadError = useUnit($loadError);
  const [options, setOptions] = useState(readOptions);
  const [copied, setCopied] = useState(false);
  const change = (patch: Partial<FreeOptions>) => {
    const next = { ...options, ...patch };
    if (next.from >= next.to) return;
    setOptions(next);
    writeJson(KEY, next);
    setCopied(false);
  };
  const found = freeSlots(events, viewDays(view, cursor), options, now);
  const text = formatFreeSlots(found, now);
  const nothing = !found.length;
  // while events for new dates are loading or failed to load, we can't compute from the old ones:
  // the week would look free
  const waiting = loading || Boolean(loadError);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className={p.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={p.dialog} role="dialog" aria-modal="true" aria-label={t.free.title}>
        <div className={p.head}>
          <h2>{t.free.title}</h2>
          <Button variant="ghost" icon onClick={onClose} aria-label={t.common.close}>
            <Close />
          </Button>
        </div>
        <p className={p.hint}>{t.free.hint}</p>
        <div className={f.row}>
          <label className={f.field}>
            <span>{t.free.hours}</span>
            <span className={f.range}>
              <input
                type="time"
                className={s.select}
                value={timeKeyOf(options.from)}
                onChange={(e) => e.target.value && change({ from: minutesOf(e.target.value) })}
              />
              –
              <input
                type="time"
                className={s.select}
                value={timeKeyOf(options.to)}
                onChange={(e) => e.target.value && change({ to: minutesOf(e.target.value) })}
              />
            </span>
          </label>
          <label className={f.field}>
            <span>{t.free.minLength}</span>
            <select
              className={s.select}
              value={options.minLength}
              onChange={(e) => change({ minLength: Number(e.target.value) })}
            >
              {LENGTHS.map((m) => (
                <option key={m} value={m}>
                  {t.free.minutes(new Intl.NumberFormat(locale).format(m))}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className={f.check}>
          <input type="checkbox" checked={options.weekends} onChange={(e) => change({ weekends: e.target.checked })} />
          {t.free.weekends}
        </label>
        {/* empty is not a dead end: why, and where to go next */}
        {waiting ? (
          <p className={f.empty} role="status">
            {loading ? t.common.loading : loadError}
          </p>
        ) : nothing ? (
          <p className={f.empty} role="status">
            <b>{t.free.none}</b> {t.free.noneReason}
          </p>
        ) : (
          <textarea className={f.preview} readOnly value={text} rows={8} aria-label={t.free.title} />
        )}
        <div className={f.actions}>
          {nothing && !waiting && <Button onClick={() => next()}>{t.free.showLater}</Button>}
          <Button variant="primary" disabled={nothing || waiting} onClick={() => void copyText(text).then(setCopied)}>
            {copied ? t.free.copied : t.free.copy}
          </Button>
        </div>
      </div>
    </div>
  );
};

export const FreeSlotsButton = () => {
  const [open, setOpen] = useState(false);
  // Ctrl+K → "Free time"
  useEffect(() => freeSlotsRequested.watch(() => setOpen(true)), []);
  return (
    <>
      <Button
        variant="ghost"
        icon
        onClick={() => setOpen(true)}
        title={t.toolbar.freeSlots}
        aria-label={t.toolbar.freeSlots}
      >
        <Clock />
      </Button>
      {open && <FreeSlotsDialog onClose={() => setOpen(false)} />}
    </>
  );
};
