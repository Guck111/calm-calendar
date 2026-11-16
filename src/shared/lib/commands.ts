// Command menu (Ctrl+K): jump to a date, create, search and views from one input,
// and if an event is selected — actions on it: to tomorrow, an hour later, Google Meet, color.
// The date is understood by the same parser as quick add — in all 11 languages.
import { t } from "../i18n";
import { COLOR_IDS } from "./colors";
import { formatWeekdayDayMonth, startOfDay, type ViewMode } from "./date";
import { hasValidQuickDate, parseQuick } from "./quick";
import type { Theme } from "./theme";

export type Command =
  | { kind: "date"; date: Date }
  | { kind: "create"; text: string }
  | { kind: "search"; text: string }
  | { kind: "new" }
  | { kind: "today" }
  | { kind: "view"; view: ViewMode }
  /** keyboard shortcuts window */
  | { kind: "shortcuts" }
  /** "What Calm Calendar can do" card */
  | { kind: "welcome" }
  /** find by name: free time, theme (there is no theme button on the toolbar) */
  | { kind: "free" }
  | { kind: "theme"; theme: Theme }
  /** actions on the selected event */
  | { kind: "tomorrow" }
  | { kind: "later" }
  | { kind: "meet" }
  /** "" — calendar color */
  | { kind: "color"; colorId: string };

/** Selected event that can be changed (our own or in a writable calendar) */
export type CommandSubject = { title: string; allDay: boolean; hasMeet: boolean };

const VIEWS: ViewMode[] = ["day", "week", "month", "agenda"];

const STATIC: Command[] = [
  { kind: "new" },
  { kind: "today" },
  ...VIEWS.map((view) => ({ kind: "view" as const, view })),
  { kind: "shortcuts" },
  { kind: "welcome" },
];

/** only on a text match, they aren't in the empty input */
const FOUND_BY_NAME: Command[] = [
  { kind: "free" },
  ...(["light", "dark", "system"] as const).map((theme) => ({ kind: "theme" as const, theme })),
];

const COLORS: Command[] = ["", ...COLOR_IDS].map((colorId) => ({ kind: "color" as const, colorId }));

export const commandLabel = (c: Command): string => {
  switch (c.kind) {
    case "date":
      return t.commands.goTo(formatWeekdayDayMonth(c.date));
    case "create":
      return t.commands.create(c.text);
    case "search":
      return t.commands.search(c.text);
    case "new":
      return t.common.newEvent;
    case "today":
      return t.common.today;
    case "view":
      return t.toolbar.views[c.view];
    case "shortcuts":
      return t.shortcuts.title;
    case "free":
      return t.free.title;
    case "theme":
      return `${t.settings.theme}: ${t.settings.themes[c.theme]}`;
    case "welcome":
      return t.welcome.command;
    case "tomorrow":
      return t.commands.moveTomorrow;
    case "later":
      return t.commands.hourLater;
    case "meet":
      return t.editor.addMeet;
    case "color": {
      const names: Record<string, string> = t.editor.colorNames;
      return t.commands.color(c.colorId ? names[c.colorId] : t.editor.calendarColor);
    }
  }
};

/** Event actions: "an hour later" — only for timed events, Meet — if there is no call yet */
const eventCommands = (subject: CommandSubject): Command[] => [
  { kind: "tomorrow" },
  ...(subject.allDay ? [] : [{ kind: "later" } as const]),
  ...(subject.hasMeet ? [] : [{ kind: "meet" } as const]),
];

/** What to offer for the text: a date (if the whole text is a date), "create" and "search" with this text,
 *  and commands whose names contain it. With a selected event — its actions first;
 *  colors (there are twelve) — only when the text matched a name */
export const buildCommands = (input: string, now: Date, subject?: CommandSubject | null): Command[] => {
  const text = input.trim();
  const own = subject ? eventCommands(subject) : [];
  if (!text) return [...own, ...STATIC];
  const found: Command[] = [];
  const parsed = parseQuick(text, now);
  if (!parsed.title && hasValidQuickDate(parsed)) found.push({ kind: "date", date: startOfDay(parsed.start) });
  found.push({ kind: "create", text }, { kind: "search", text });
  const needle = text.toLocaleLowerCase();
  const matches = (c: Command) => commandLabel(c).toLocaleLowerCase().includes(needle);
  return [...found, ...[...own, ...(subject ? COLORS : []), ...STATIC, ...FOUND_BY_NAME].filter(matches)];
};
