// Меню команд на Ctrl+K: перейти к дате, создать событие, найти, сменить вид — одной строкой с клавиатуры.
// Строка — combobox, команды — listbox: стрелки выбирают, Enter выполняет, Esc закрывает.
import { useUnit } from "effector-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { t } from "../shared/i18n";
import { $writableCalendars } from "../model/calendars";
import { $opened, createClicked, draftOpened, eventMoved, eventPatched } from "../model/editor";
import { $events } from "../model/events";
import { eventElement } from "../app/useEventKeys";
import type { CalendarEvent } from "../shared/api/types";
import { queryChanged, searchFocusRequested, searchRequested } from "../model/search";
import { shortcutsRequested } from "../model/shortcuts";
import { dateSelected, todayClicked, viewChanged } from "../model/view";
import { buildCommands, commandLabel, type Command } from "../shared/lib/commands";
import { addDays, addMinutes, localTimeZone } from "../shared/lib/date";
import { parseQuick, quickToDraft } from "../shared/lib/quick";
import { cx } from "./Button";
import s from "./CommandMenu.module.css";

const LIST_ID = "command-menu-list";

type DialogProps = {
  onClose: () => void;
  /** выбранное событие, которое можно менять: его действия — первыми */
  subject: CalendarEvent | null;
};

const CommandDialog = ({ onClose, subject }: DialogProps) => {
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const [move, patch, showShortcuts] = useUnit([eventMoved, eventPatched, shortcutsRequested]);
  const [writable, goTo, today, setView, create, openDraft, search, request, focusSearch] = useUnit([
    $writableCalendars,
    dateSelected,
    todayClicked,
    viewChanged,
    createClicked,
    draftOpened,
    queryChanged,
    searchRequested,
    searchFocusRequested,
  ]);
  const commands = buildCommands(
    text,
    new Date(),
    subject && { title: subject.title, allDay: subject.allDay, hasMeet: Boolean(subject.meeting) },
  );
  const current = Math.min(active, Math.max(0, commands.length - 1));

  useEffect(() => input.current?.focus(), []);

  const run = (c: Command) => {
    onClose();
    switch (c.kind) {
      case "date":
        return goTo(c.date);
      case "today":
        return today();
      case "view":
        return setView(c.view);
      case "new":
        return create();
      case "shortcuts":
        return showShortcuts();
      case "create": {
        // как Ctrl+Enter в быстром создании: форма с разобранной строкой
        const draft = quickToDraft(parseQuick(c.text, new Date(), writable), writable[0]?.id ?? "");
        return openDraft({ ...draft, timeZone: localTimeZone(), guests: [], addMeet: false, attachments: [] });
      }
      case "search":
        search(c.text);
        request();
        return focusSearch();
    }
    if (!subject) return;
    switch (c.kind) {
      case "tomorrow":
        return move({ event: subject, start: addDays(subject.start, 1), end: addDays(subject.end, 1) });
      case "later":
        return move({ event: subject, start: addMinutes(subject.start, 60), end: addMinutes(subject.end, 60) });
      case "meet":
        return patch({ event: subject, patch: { addMeet: true } });
      case "color":
        return patch({ event: subject, patch: { colorId: c.colorId } });
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((current + step + commands.length) % Math.max(1, commands.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (commands[current]) run(commands[current]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className={s.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={s.dialog} role="dialog" aria-modal="true" aria-label={t.commands.title}>
        <input
          ref={input}
          className={s.input}
          role="combobox"
          aria-expanded="true"
          aria-controls={LIST_ID}
          aria-activedescendant={commands.length ? `${LIST_ID}-${current}` : undefined}
          aria-label={t.commands.title}
          placeholder={t.commands.placeholder}
          spellCheck={false}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        {subject && <p className={s.subject}>{subject.title}</p>}
        <ul className={s.list} id={LIST_ID} role="listbox" aria-label={t.commands.title}>
          {commands.map((c, i) => (
            <li
              key={`${c.kind}-${i}`}
              id={`${LIST_ID}-${i}`}
              role="option"
              aria-selected={i === current}
              className={cx(s.item, i === current && s.active)}
              onMouseMove={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => run(c)}
            >
              {commandLabel(c)}
            </li>
          ))}
          {!commands.length && <li className={s.empty}>{t.commands.none}</li>}
        </ul>
      </div>
    </div>
  );
};

/** Ctrl+K в любой раскладке (по коду клавиши) открывает меню, даже из поля ввода */
export const CommandMenu = () => {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState<CalendarEvent | null>(null);
  const [events, opened, writable] = useUnit([$events, $opened, $writableCalendars]);
  // свежие значения для обработчика клавиш без его пересоздания
  const latest = useRef({ events, opened, writable });
  latest.current = { events, opened, writable };

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === "KeyK") {
        e.preventDefault();
        // выбранное событие: блок под фокусом или открытая карточка; только то, что можно менять
        const { events: list, opened: card, writable: own } = latest.current;
        const key = eventElement(document.activeElement)?.dataset.eventKey;
        const event = (key && list.find((x) => x.key === key)) || card;
        setSubject(event && own.some((c) => c.id === event.calendarId) ? event : null);
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return open ? <CommandDialog onClose={() => setOpen(false)} subject={subject} /> : null;
};
