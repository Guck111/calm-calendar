// Меню команд (Ctrl+K): переход к дате, создание, поиск и виды из одной строки,
// а если выбрано событие — действия с ним: на завтра, на час позже, Google Meet, цвет.
// Дату понимает тот же разбор, что и быстрое создание, — на всех 11 языках.
import { t } from "../i18n";
import { COLOR_IDS } from "./colors";
import { formatWeekdayDayMonth, startOfDay, type ViewMode } from "./date";
import { parseQuick } from "./quick";

export type Command =
  | { kind: "date"; date: Date }
  | { kind: "create"; text: string }
  | { kind: "search"; text: string }
  | { kind: "new" }
  | { kind: "today" }
  | { kind: "view"; view: ViewMode }
  /** окно со списком сочетаний клавиш */
  | { kind: "shortcuts" }
  /** действия с выбранным событием */
  | { kind: "tomorrow" }
  | { kind: "later" }
  | { kind: "meet" }
  /** "" — цвет календаря */
  | { kind: "color"; colorId: string };

/** Выбранное событие, которое можно менять (своё или в календаре с правом записи) */
export type CommandSubject = { title: string; allDay: boolean; hasMeet: boolean };

const VIEWS: ViewMode[] = ["day", "week", "month", "agenda"];

const STATIC: Command[] = [
  { kind: "new" },
  { kind: "today" },
  ...VIEWS.map((view) => ({ kind: "view" as const, view })),
  { kind: "shortcuts" },
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

/** Действия с событием: «на час позже» — только у события со временем, Meet — если созвона ещё нет */
const eventCommands = (subject: CommandSubject): Command[] => [
  { kind: "tomorrow" },
  ...(subject.allDay ? [] : [{ kind: "later" } as const]),
  ...(subject.hasMeet ? [] : [{ kind: "meet" } as const]),
];

/** Что предложить по тексту: дату (если весь текст — дата), «создать» и «найти» с этим текстом,
 *  и команды, в названии которых он встречается. С выбранным событием — сначала действия с ним;
 *  цвета (их двенадцать) — только когда текст совпал с названием */
export const buildCommands = (input: string, now: Date, subject?: CommandSubject | null): Command[] => {
  const text = input.trim();
  const own = subject ? eventCommands(subject) : [];
  if (!text) return [...own, ...STATIC];
  const found: Command[] = [];
  const parsed = parseQuick(text, now);
  if (!parsed.title) found.push({ kind: "date", date: startOfDay(parsed.start) });
  found.push({ kind: "create", text }, { kind: "search", text });
  const needle = text.toLocaleLowerCase();
  const matches = (c: Command) => commandLabel(c).toLocaleLowerCase().includes(needle);
  return [...found, ...[...own, ...(subject ? COLORS : []), ...STATIC].filter(matches)];
};
