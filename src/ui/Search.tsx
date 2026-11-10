import { useUnit } from "effector-react";
import { t } from "../shared/i18n";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { $calendarById } from "../model/calendars";
import { eventOpened } from "../model/editor";
import { $query, $results, $searching, queryChanged, searchClosed, searchRequested } from "../model/search";
import { dayOpened } from "../model/view";
import type { CalendarEvent } from "../shared/api/types";
import { formatShortDate, formatTime } from "../shared/lib/date";
import { eventStyle } from "./eventColor";
import s from "./Search.module.css";

const DEBOUNCE_MS = 350;


export const Search = () => {
  const [query, results, searching, byId] = useUnit([$query, $results, $searching, $calendarById]);
  const [change, close, request, openDay, openEvent] = useUnit([
    queryChanged,
    searchClosed,
    searchRequested,
    dayOpened,
    eventOpened,
  ]);
  const input = useRef<HTMLInputElement>(null);

  // поиск запускается после паузы в наборе
  useEffect(() => {
    const t = window.setTimeout(() => request(), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [query, request]);

  // Ctrl+F или / — к строке поиска
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if ((e.ctrlKey && e.code === "KeyF") || (!typing && e.key === "/")) {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pick = (e: CalendarEvent) => {
    openDay(e.start);
    openEvent(e);
    close();
    input.current?.blur();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      close();
      input.current?.blur();
    }
    if (e.key === "Enter" && results?.length) pick(results[0]);
  };

  return (
    <div className={s.search}>
      <input
        ref={input}
        className={s.input}
        value={query}
        onChange={(e) => change(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={t.search.placeholder}
        spellCheck={false}
        aria-label={t.search.label}
      />
      {results !== null && query.trim() && (
        <div className={s.results} role="listbox">
          {!results.length ? (
            <div className={s.empty}>{searching ? t.search.searching : t.search.nothing}</div>
          ) : (
            results.map((e) => (
              <button
                key={e.key}
                className={s.item}
                style={eventStyle(byId.get(e.calendarId), e)}
                onClick={() => pick(e)}
                role="option"
              >
                <span className={s.when}>
                  {formatShortDate(e.start)}
                  {!e.allDay && `, ${formatTime(e.start)}`}
                </span>
                <span className={s.title}>{e.title}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};
