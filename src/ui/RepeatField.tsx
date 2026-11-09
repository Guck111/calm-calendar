import { useState } from "react";
import { t } from "../shared/i18n";
import { draftZone } from "../shared/api/calendar";
import type { EventDraft } from "../shared/api/types";
import { addMonths, toDateKey } from "../shared/lib/date";
import {
  FREQS,
  PRESETS,
  buildRecurrence,
  describeRule,
  monthlyNth,
  orderedWeekdays,
  parseRecurrence,
  presetOf,
  presetRule,
  weekdayLabel,
  weekdayLongName,
  weekdayOf,
  type Freq,
  type PresetId,
  type Rule,
  type Weekday,
} from "../shared/lib/rrule";
import { draftStart } from "../model/editor";
import { cx } from "./Button";
import s from "./EventEditor.module.css";

const clamp = (value: string, max: number) => Math.min(max, Math.max(1, Math.round(Number(value)) || 1));

/** Своё правило: шаг, дни недели, вариант для месяца и окончание */
const CustomRule = ({ rule, start, onChange }: { rule: Rule; start: Date; onChange: (r: Rule) => void }) => {
  const r = t.repeat;
  const patch = (p: Partial<Rule>) => onChange({ ...rule, ...p });
  const toggle = (d: Weekday) => {
    const days = rule.days.includes(d) ? rule.days.filter((x) => x !== d) : [...rule.days, d];
    if (days.length) patch({ days });
  };
  const setFreq = (freq: Freq) =>
    patch({ freq, days: freq === "WEEKLY" ? (rule.days.length ? rule.days : [weekdayOf(start)]) : [], nth: undefined });
  const untilDate = rule.end.kind === "until" ? rule.end.date : toDateKey(addMonths(start, 3));
  const count = rule.end.kind === "count" ? rule.end.count : 10;

  return (
    <div className={s.custom}>
      <div className={s.row}>
        <span className={s.rowLabel}>{r.interval}</span>
        <input
          type="number"
          className={s.num}
          min={1}
          max={99}
          value={rule.interval}
          onChange={(e) => patch({ interval: clamp(e.target.value, 99) })}
          aria-label={r.interval}
        />
        <select value={rule.freq} onChange={(e) => setFreq(e.target.value as Freq)} aria-label={r.label}>
          {FREQS.map((f) => (
            <option key={f} value={f}>
              {r.unit(f, rule.interval)}
            </option>
          ))}
        </select>
      </div>

      {rule.freq === "WEEKLY" && (
        <div className={s.days} role="group" aria-label={r.days}>
          {orderedWeekdays().map((d) => (
            <button
              key={d}
              type="button"
              className={cx(s.day, rule.days.includes(d) && s.dayOn)}
              aria-pressed={rule.days.includes(d)}
              title={weekdayLongName(d)}
              onClick={() => toggle(d)}
            >
              {weekdayLabel(d)}
            </button>
          ))}
        </div>
      )}

      {rule.freq === "MONTHLY" && (
        <select
          value={rule.nth ? "nth" : "day"}
          onChange={(e) => patch({ nth: e.target.value === "nth" ? monthlyNth(start) : undefined })}
          aria-label={r.label}
        >
          <option value="day">{r.onMonthDay(start.getDate())}</option>
          <option value="nth">{r.onNth(monthlyNth(start), start.getDay(), weekdayLongName(weekdayOf(start)))}</option>
        </select>
      )}

      <fieldset className={s.ends}>
        <legend>{r.ends}</legend>
        <label className={s.end}>
          <input type="radio" checked={rule.end.kind === "never"} onChange={() => patch({ end: { kind: "never" } })} />
          {r.never}
        </label>
        <label className={s.end}>
          <input
            type="radio"
            checked={rule.end.kind === "until"}
            onChange={() => patch({ end: { kind: "until", date: untilDate } })}
          />
          {r.until}
          <input
            type="date"
            value={untilDate}
            min={toDateKey(start)}
            onChange={(e) => e.target.value && patch({ end: { kind: "until", date: e.target.value } })}
            aria-label={r.until}
          />
        </label>
        <label className={s.end}>
          <input
            type="radio"
            checked={rule.end.kind === "count"}
            onChange={() => patch({ end: { kind: "count", count } })}
          />
          {r.count}
          <input
            type="number"
            className={s.num}
            min={1}
            max={999}
            value={count}
            onChange={(e) => patch({ end: { kind: "count", count: clamp(e.target.value, 999) } })}
            aria-label={r.count}
          />
          {r.countUnit(count)}
        </label>
      </fieldset>
    </div>
  );
};

type Props = {
  draft: EventDraft;
  /** правило серии ещё грузится */
  loading: boolean;
  onChange: (recurrence: string[]) => void;
};

/** Поле «Повтор»: готовые варианты от даты начала и своё правило */
export const RepeatField = ({ draft, loading, onChange }: Props) => {
  const [customOpen, setCustomOpen] = useState(false);
  const r = t.repeat;
  const start = draftStart(draft);
  if (Number.isNaN(start.getTime())) return null;

  const zone = draftZone(draft);
  const { rule, extra } = parseRecurrence(draft.recurrence, start, zone);
  const repeating = draft.recurrence.length > 0;
  const preset = rule ? presetOf(rule, start) : null;
  const value = loading ? "loading" : !repeating ? "none" : !rule ? "special" : customOpen || !preset ? "custom" : preset;
  const set = (next: Rule | null) => onChange(buildRecurrence(next, extra, start, draft.allDay, zone));

  const onSelect = (v: string) => {
    if (v === "none") {
      setCustomOpen(false);
      set(null);
    } else if (v === "custom") {
      setCustomOpen(true);
      if (!rule) set(presetRule("weekly", start));
    } else if (v !== "special") {
      setCustomOpen(false);
      set(presetRule(v as PresetId, start));
    }
  };

  return (
    <>
      <label className={s.field}>
        <span>{r.label}</span>
        <select value={value} onChange={(e) => onSelect(e.target.value)} disabled={loading}>
          {loading && <option value="loading">{r.loading}</option>}
          <option value="none">{r.none}</option>
          {PRESETS.map((id) => (
            <option key={id} value={id}>
              {describeRule(presetRule(id, start), start)}
            </option>
          ))}
          {value === "special" && <option value="special">{r.special}</option>}
          <option value="custom">{value === "custom" && rule ? describeRule(rule, start) : r.custom}</option>
        </select>
      </label>
      {value === "custom" && rule && <CustomRule rule={rule} start={start} onChange={set} />}
    </>
  );
};
