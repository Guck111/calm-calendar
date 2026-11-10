// Меню команд (Ctrl+K): переход к дате, создание, поиск и виды из одной строки.
// Дату понимает тот же разбор, что и быстрое создание, — на всех 11 языках.
import { t } from "../i18n";
import { formatWeekdayDayMonth, startOfDay, type ViewMode } from "./date";
import { parseQuick } from "./quick";

export type Command =
  | { kind: "date"; date: Date }
  | { kind: "create"; text: string }
  | { kind: "search"; text: string }
  | { kind: "new" }
  | { kind: "today" }
  | { kind: "view"; view: ViewMode };

const VIEWS: ViewMode[] = ["day", "week", "month", "agenda"];

const STATIC: Command[] = [{ kind: "new" }, { kind: "today" }, ...VIEWS.map((view) => ({ kind: "view" as const, view }))];

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
  }
};

/** Что предложить по тексту: дату (если весь текст — дата), «создать» и «найти» с этим текстом,
 *  и команды, в названии которых он встречается */
export const buildCommands = (input: string, now: Date): Command[] => {
  const text = input.trim();
  if (!text) return STATIC;
  const found: Command[] = [];
  const parsed = parseQuick(text, now);
  if (!parsed.title) found.push({ kind: "date", date: startOfDay(parsed.start) });
  found.push({ kind: "create", text }, { kind: "search", text });
  const needle = text.toLocaleLowerCase();
  return [...found, ...STATIC.filter((c) => commandLabel(c).toLocaleLowerCase().includes(needle))];
};
