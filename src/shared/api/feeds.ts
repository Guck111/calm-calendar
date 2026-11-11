// Загрузка подписок .ics: файл скачивает Rust (fetch_feed), разбирает lib/ics.
// Разобранный файл держим в памяти 10 минут: виды и виджет просят события часто, а файл меняется редко.
// Последний скачанный текст лежит в localStorage — без сети подписка показывает его.
import { t } from "../i18n";
import { expandIcs, parseIcs, type IcsCalendar } from "../lib/ics";
import { FEED_ACCOUNT, FEEDS_KEY, parseFeeds, type Feed } from "../lib/feeds";
import type { DateRange } from "../lib/date";
import { readJson } from "../lib/storage";
import { fetchFeed } from "./bridge";
import { splitRef } from "./calendar";
import type { CalendarEvent } from "./types";

const FRESH_MS = 10 * 60_000;
/** больше этого текст не сохраняем: localStorage на всё приложение около 5 МБ */
const SAVE_LIMIT = 1_500_000;
const savedKey = (id: string) => `calm.feedCache.${id}`;

const memory = new Map<string, { at: number; url: string; cal: IcsCalendar }>();

/** кнопка «Обновить»: следующий запрос скачает подписки заново */
export const forgetFeeds = (): void => memory.clear();

/** убрать сохранённое у удалённой подписки */
export const dropFeedCache = (id: string): void => {
  memory.delete(id);
  try {
    localStorage.removeItem(savedKey(id));
  } catch {
    // хранилище недоступно — нечего и убирать
  }
};

/** в файле есть календарь: пустой календарь тоже календарь, а страница сайта — нет */
export const isCalendarText = (text: string): boolean => /BEGIN:VCALENDAR/i.test(text);

/** Скачать и разобрать файл по ссылке; не календарь — ошибка с понятным текстом */
export const downloadFeed = async (url: string): Promise<IcsCalendar> => {
  const text = await fetchFeed(url);
  if (!isCalendarText(text)) throw { kind: "other", message: t.settings.feedNotIcs };
  return parseIcs(text);
};

const loadFeed = async (feed: Feed): Promise<IcsCalendar> => {
  const cached = memory.get(feed.id);
  if (cached && cached.url === feed.url && Date.now() - cached.at < FRESH_MS) return cached.cal;
  try {
    const text = await fetchFeed(feed.url);
    if (!isCalendarText(text)) throw { kind: "other", message: t.settings.feedNotIcs };
    const cal = parseIcs(text);
    memory.set(feed.id, { at: Date.now(), url: feed.url, cal });
    try {
      if (text.length <= SAVE_LIMIT) localStorage.setItem(savedKey(feed.id), text);
    } catch {
      // места нет — без сети подписки просто не будет видно
    }
    return cal;
  } catch (e) {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(savedKey(feed.id));
    } catch {
      saved = null;
    }
    if (saved === null) throw e;
    const cal = parseIcs(saved);
    memory.set(feed.id, { at: Date.now(), url: feed.url, cal });
    return cal;
  }
};

const feedOf = (calendarId: string): Feed | undefined => {
  const { googleId } = splitRef(calendarId);
  return parseFeeds(readJson<unknown>(FEEDS_KEY, [])).find((f) => f.id === googleId);
};

/** события подписки в промежутке */
export const listFeedEvents = async (calendarId: string, range: DateRange): Promise<CalendarEvent[]> => {
  const feed = feedOf(calendarId);
  if (!feed) return [];
  return expandIcs(await loadFeed(feed), range, calendarId, FEED_ACCOUNT, t.common.untitled);
};

/** поиск по подписке: в названии, месте и описании, за тот же срок, что ищет Google */
export const searchFeedEvents = async (calendarId: string, query: string, range: DateRange, limit: number): Promise<CalendarEvent[]> => {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const events = await listFeedEvents(calendarId, range);
  return events
    .filter((e) => [e.title, e.location, e.description].some((v) => v?.toLocaleLowerCase().includes(needle)))
    .slice(0, limit);
};
