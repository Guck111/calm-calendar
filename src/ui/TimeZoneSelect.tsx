import { useMemo } from "react";
import { localTimeZone } from "../shared/lib/date";
import { sortedTimeZones, zoneLabel } from "../shared/lib/tz";

type Props = {
  value: string;
  onChange: (zone: string) => void;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
};

/** Список всех поясов по смещению. Пояс системы стоит первым; пояс, которого нет в списке Intl
 *  (бывает у старых событий Google), добавляется, чтобы значение не терялось */
export const TimeZoneSelect = ({ value, onChange, className, disabled, "aria-label": label }: Props) => {
  const options = useMemo(() => {
    const now = new Date();
    const system = localTimeZone();
    const list = sortedTimeZones(now).map((z) => z.zone);
    const zones = [system, ...list.filter((z) => z !== system)];
    if (value && !zones.includes(value)) zones.splice(1, 0, value);
    return zones.map((zone) => ({ zone, label: zoneLabel(zone, now) }));
  }, [value]);
  return (
    <select
      className={className}
      value={value}
      disabled={disabled}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.zone} value={o.zone}>
          {o.label}
        </option>
      ))}
    </select>
  );
};
