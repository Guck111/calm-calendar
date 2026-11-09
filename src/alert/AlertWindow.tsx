// Окно заметного напоминания: Rust открывает его поверх всех окон за минуту до начала события.
// Список открытых напоминаний живёт в Rust (get_alerts), окно только показывает его и отвечает
// кнопками: «Подключиться», «Отложить на 5 мин», «Закрыть».
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { inTauri, subscribe } from "../shared/api/bus";
import { openExternal } from "../shared/api/open";
import { t } from "../shared/i18n";
import { formatTime } from "../shared/lib/date";
import { Video } from "../ui/icons";
import s from "./Alert.module.css";

export type AlertItem = { key: string; title: string; start: number; end: number; url?: string; provider?: string };

const WIDTH = 460;
const SNOOZE_MINUTES = 5;

/** в обычном браузере (npm run dev) — пример, чтобы видеть окно без Tauri */
const demo = (): AlertItem[] => {
  const start = Date.now() + 60_000;
  return [
    {
      key: "demo",
      title: "Design sync",
      start,
      end: start + 30 * 60_000,
      url: "https://meet.google.com/abc-defg-hij",
      provider: "Google Meet",
    },
  ];
};

const span = (ms: number): string => {
  const total = Math.max(1, Math.ceil(ms / 60_000));
  return t.time.span(Math.floor(total / 60), total % 60);
};

/** «через 1 мин», «начинается сейчас», «идёт, ещё 25 мин» */
export const alertStatus = (a: Pick<AlertItem, "start" | "end">, now: number): string => {
  if (a.start - now > 30_000) return t.time.in(span(a.start - now));
  if (a.start > now - 60_000) return t.reminders.startsNow;
  return t.time.ongoing(span(a.end - now));
};

const startDrag = async (e: MouseEvent) => {
  if (e.button !== 0 || !inTauri || (e.target as HTMLElement).closest("button")) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().startDragging();
};

export const AlertWindow = () => {
  const [items, setItems] = useState<AlertItem[]>(() => (inTauri ? [] : demo()));
  const [now, setNow] = useState(Date.now);
  const cardRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    if (inTauri) void invoke<AlertItem[]>("get_alerts").then(setItems);
  }, []);

  useEffect(() => {
    load();
    const off = subscribe("alerts-changed", load);
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      off();
      window.clearInterval(timer);
    };
  }, [load]);

  // окно по высоте содержимого, как виджет
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card || !inTauri) return;
    let cancelled = false;
    const resize = async () => {
      const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
      if (!cancelled) await getCurrentWindow().setSize(new LogicalSize(WIDTH, Math.ceil(card.offsetHeight)));
    };
    const observer = new ResizeObserver(() => void resize());
    observer.observe(card);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, []);

  const drop = (key: string) => setItems((list) => list.filter((a) => a.key !== key));
  const dismiss = (key: string) => (inTauri ? void invoke("dismiss_alert", { key }) : drop(key));
  const snooze = (key: string) => (inTauri ? void invoke("snooze_alert", { key, minutes: SNOOZE_MINUTES }) : drop(key));
  const join = (a: AlertItem) => {
    if (a.url) void openExternal(a.url);
    dismiss(a.key);
  };

  // Enter — подключиться (или закрыть, если встречи нет), Esc — закрыть
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const first = items[0];
      if (!first) return;
      if (e.key === "Escape") dismiss(first.key);
      if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) (first.url ? join(first) : dismiss(first.key));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className={s.card} ref={cardRef} onMouseDown={(e) => void startDrag(e)}>
      {items.map((a, i) => (
        <section key={a.key} className={s.item}>
          <div className={s.status}>{alertStatus(a, now)}</div>
          <h1 className={s.title}>{a.title}</h1>
          <div className={s.when}>
            {formatTime(new Date(a.start))}–{formatTime(new Date(a.end))}
            {a.provider && <span className={s.provider}> · {a.provider}</span>}
          </div>
          <div className={s.actions}>
            {a.url && (
              <button className={s.primary} onClick={() => join(a)} autoFocus={i === 0}>
                <Video size={15} /> {t.meeting.join}
              </button>
            )}
            <button onClick={() => snooze(a.key)}>{t.alert.snooze}</button>
            <button className={s.quiet} onClick={() => dismiss(a.key)} autoFocus={i === 0 && !a.url}>
              {t.alert.dismiss}
            </button>
          </div>
        </section>
      ))}
    </div>
  );
};
