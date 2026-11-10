// Common setup of the interface tests: a fixed clock, the app language and settings in localStorage.
import { test as base, expect, type Page } from "@playwright/test";
import type { Lang } from "../../src/shared/i18n";
import { en } from "../../src/shared/i18n/en";
import { ru } from "../../src/shared/i18n/ru";
import { es } from "../../src/shared/i18n/es";
import { fr } from "../../src/shared/i18n/fr";
import { pt } from "../../src/shared/i18n/pt";
import { de } from "../../src/shared/i18n/de";
import { ja } from "../../src/shared/i18n/ja";
import { zh } from "../../src/shared/i18n/zh";
import { hi } from "../../src/shared/i18n/hi";
import { ar } from "../../src/shared/i18n/ar";
import { bn } from "../../src/shared/i18n/bn";

export const DICTS = { en, ru, es, fr, pt, de, ja, zh, hi, ar, bn };

/** "Now" in every test: Wednesday 11 November 2026, 9:50 in Warsaw. The mock data is built around it:
 *  the week is 9–15 November (Monday first in en-GB), a stand-up every weekday at 9:30 */
export const NOW = { year: 2026, month: 10, day: 11, hour: 9, minute: 50 };

type Options = {
  /** app language, written to localStorage before the first load */
  lang: Lang;
  /** other localStorage keys (without the "calm." prefix), as JSON values */
  storage: Record<string, unknown>;
};

// Runs before the page's own scripts on every load. Time moves on from NOW, as in scripts/screenshots.mjs.
// localStorage is seeded only on the first load of a test: a reload keeps what the test changed.
const setup = ({ now, storage }: { now: typeof NOW; storage: Record<string, unknown> }) => {
  const Real = Date;
  const target = new Real(now.year, now.month, now.day, now.hour, now.minute).getTime();
  const offset = target - Real.now();
  class FakeDate extends Real {
    constructor(...args: unknown[]) {
      if (args.length) super(...(args as []));
      else super(Real.now() + offset);
    }
    static now() {
      return Real.now() + offset;
    }
  }
  globalThis.Date = FakeDate as DateConstructor;
  try {
    if (!sessionStorage.getItem("calm.e2e")) {
      sessionStorage.setItem("calm.e2e", "1");
      for (const [key, value] of Object.entries(storage)) localStorage.setItem(`calm.${key}`, JSON.stringify(value));
    }
  } catch {
    // about:blank has no storage
  }
};

export const test = base.extend<Options & { t: typeof en }>({
  lang: ["en", { option: true }],
  storage: [{}, { option: true }],
  t: async ({ lang }, use) => use(DICTS[lang]),
  page: async ({ page, lang, storage }, use) => {
    await page.addInitScript(setup, { now: NOW, storage: { lang, view: "week", ...storage } });
    await use(page);
  },
});

export { expect };

/** Open the calendar and wait until the mock events are on screen */
export const openApp = async (page: Page, path = "/") => {
  await page.goto(path);
  await expect(page.getByRole("tablist")).toBeVisible();
  // calendars are loaded: their switches are in the sidebar
  await expect(page.locator("aside input[type=checkbox]").first()).toBeVisible();
  // events are loaded (Week and Day): a block in a day column
  if (await page.locator('main [class*="column"]').count()) {
    await expect(page.locator('main [class*="column"] button').first()).toBeVisible();
  }
};

/** A timed event block in Week or Day by its title */
export const eventBlock = (page: Page, title: string) =>
  page.locator("main button[title]").filter({ hasText: title }).first();

/** The event card or form */
export const dialog = (page: Page) => page.getByRole("dialog");

type Stamp = [day: number, hour?: number, minute?: number];

/** Time ("19:00", "7:00 pm", "١٩:٠٠") of a November 2026 moment, formatted by the app itself in the page:
 *  the same module instance, so the same language and region */
export const timeText = (page: Page, ...stamps: Stamp[]): Promise<string[]> =>
  page.evaluate(async (list) => {
    const path = "/src/shared/lib/date.ts";
    const { formatTime } = await import(/* @vite-ignore */ path);
    return list.map(([d, h = 0, m = 0]) => formatTime(new Date(2026, 10, d, h, m)) as string);
  }, stamps);

/** "16:00–16:45" as in the title of an event block */
export const rangeText = async (page: Page, day: number, from: [number, number], to: [number, number]) => {
  const [a, b] = await timeText(page, [day, ...from], [day, ...to]);
  return `${a}–${b}`;
};

/** The day of the column an event block stands in: the head button above it holds the day number */
export const dayOfBlock = async (page: Page, block: ReturnType<Page["locator"]>): Promise<string> => {
  const box = await block.boundingBox();
  if (!box) throw new Error("the event block is not on screen");
  const x = box.x + box.width / 2;
  for (const head of await page.locator('main [class*="dayHead"]').all()) {
    const h = await head.boundingBox();
    if (h && x >= h.x && x <= h.x + h.width) return (await head.locator('[class*="date"]').innerText()).trim();
  }
  throw new Error("no day column under the event block");
};

/** Titles of the event blocks per day number of the week on screen: { "11": ["Team standup", …] } */
export const blocksByDay = (page: Page): Promise<Record<string, string[]>> =>
  page.evaluate(() => {
    const heads = [...document.querySelectorAll('main [class*="dayHead"]')];
    const columns = [...document.querySelectorAll('main [class*="column"]')];
    const result: Record<string, string[]> = {};
    columns.forEach((column, i) => {
      const day = (heads[i]?.querySelector('[class*="date"]') as HTMLElement | null)?.innerText.trim() ?? String(i);
      for (const block of column.querySelectorAll(":scope > button")) {
        const title = (block.querySelector('[class*="eventTitle"]') as HTMLElement | null)?.innerText.trim() ?? "";
        (result[day] ??= []).push(title);
      }
    });
    return result;
  });

/** The block of an event on one day (a series has one per day) */
export const blockOn = async (page: Page, title: string, day: number) => {
  const want = await dayNumber(page, day);
  await expect(eventBlock(page, title)).toBeVisible();
  for (const block of await page.locator("main button[title]").filter({ hasText: title }).all()) {
    if ((await dayOfBlock(page, block)) === want) return block;
  }
  throw new Error(`no "${title}" on day ${day}`);
};

/** Day numbers as the app writes them ("12", "١٢", "১২") */
export const dayNumber = (page: Page, day: number): Promise<string> =>
  page.evaluate(async (d) => {
    const path = "/src/shared/lib/date.ts";
    const { formatDayNumber } = await import(/* @vite-ignore */ path);
    return formatDayNumber(new Date(2026, 10, d)) as string;
  }, day);

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
