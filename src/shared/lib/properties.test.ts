import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import type { CalendarEvent } from "../api/types";
import { LANGS, setLang } from "../i18n";
import { addDays, addMinutes, daysBetween, fromDateKey, isoWeek, startOfWeek, toDateKey, weekdayIndex } from "./date";
import { DRAG_STEP, shiftEvent, snap } from "./drag";
import { parseIcs, unescapeText } from "./ics";
import { isAllDayLike, layoutDay, overlapsDay } from "./layout";
import { parseQuick } from "./quick";
import { formatRule, monthlyNth, parseRecurrence, WEEKDAYS, type Rule } from "./rrule";

afterEach(() => setLang("ru"));

const day = new Date(2026, 10, 4);

const ev = (id: string, start: Date, end: Date): CalendarEvent => ({
  key: id,
  id,
  calendarId: "c",
  account: "",
  title: id,
  start,
  end,
  allDay: false,
  recurring: false,
});

/** a local date at noon: no clock change can land on it */
const noonDate = fc
  .record({ y: fc.integer({ min: 1971, max: 2099 }), m: fc.integer({ min: 0, max: 11 }), d: fc.integer({ min: 1, max: 28 }) })
  .map(({ y, m, d }) => new Date(y, m, d, 12, 0));

describe("day layout for any set of events", () => {
  const events = fc.array(
    fc.record({ start: fc.integer({ min: -180, max: 24 * 60 + 180 }), length: fc.integer({ min: 0, max: 600 }) }),
    { maxLength: 30 },
  );

  it("places every timed event of the day once, inside the day, and never on top of another", () => {
    fc.assert(
      fc.property(events, (specs) => {
        const list = specs.map((s, i) => ev(String(i), addMinutes(day, s.start), addMinutes(day, s.start + s.length)));
        const placed = layoutDay(list, day);
        const expected = list.filter((e) => !isAllDayLike(e) && overlapsDay(e, day)).map((e) => e.key);
        expect(placed.map((p) => p.event.key).sort()).toEqual(expected.sort());
        for (const p of placed) {
          expect(0 <= p.startMin && p.startMin < p.endMin && p.endMin <= 24 * 60).toBe(true);
          expect(p.column).toBeLessThan(p.columns);
        }
        for (const p of placed) {
          for (const q of placed) {
            const overlap = p !== q && p.startMin < q.endMin && q.startMin < p.endMin;
            if (!overlap) continue;
            expect(p.column).not.toBe(q.column);
            expect(p.columns).toBe(q.columns);
          }
        }
      }),
    );
  });
});

describe("dates", () => {
  it("a date key reads back as the same day", () => {
    fc.assert(
      fc.property(noonDate, (d) => {
        expect(toDateKey(fromDateKey(toDateKey(d)))).toBe(toDateKey(d));
      }),
    );
  });

  it("moving by days and back returns the same wall clock time", () => {
    fc.assert(
      fc.property(noonDate, fc.integer({ min: -800, max: 800 }), (d, n) => {
        const moved = addDays(d, n);
        expect(daysBetween(d, moved)).toBe(n);
        expect(moved.getHours()).toBe(12);
        expect(addDays(moved, -n).getTime()).toBe(d.getTime());
      }),
    );
  });

  it("a week starts on its first day, at most six days back", () => {
    fc.assert(
      fc.property(noonDate, (d) => {
        const start = startOfWeek(d);
        expect(weekdayIndex(start)).toBe(0);
        expect(daysBetween(start, d)).toBe(weekdayIndex(d));
      }),
    );
  });

  it("an ISO week number is between 1 and 53", () => {
    fc.assert(
      fc.property(noonDate, (d) => {
        expect(isoWeek(d)).toBeGreaterThanOrEqual(1);
        expect(isoWeek(d)).toBeLessThanOrEqual(53);
      }),
    );
  });
});

describe("dragging", () => {
  it("snaps to the nearest step", () => {
    fc.assert(
      fc.property(fc.integer({ min: -10_000, max: 10_000 }), (m) => {
        const s = snap(m);
        expect(s % DRAG_STEP === 0).toBe(true);
        expect(Math.abs(s - m)).toBeLessThanOrEqual(DRAG_STEP / 2);
      }),
    );
  });

  it("moving keeps the length, resizing keeps at least one step", () => {
    const span = fc.record({ start: fc.integer({ min: 0, max: 1439 }), length: fc.integer({ min: 15, max: 600 }) });
    fc.assert(
      fc.property(span, fc.integer({ min: -2000, max: 2000 }), fc.integer({ min: -30, max: 30 }), (s, delta, days) => {
        const e = { start: addMinutes(day, s.start), end: addMinutes(day, s.start + s.length) };
        const moved = shiftEvent(e, "move", delta, days);
        expect(moved.end.getTime() - moved.start.getTime()).toBe(s.length * 60_000);
        const resized = shiftEvent(e, "resize", delta, 0);
        expect(resized.start).toEqual(e.start);
        expect(resized.end.getTime() - e.start.getTime()).toBeGreaterThanOrEqual(DRAG_STEP * 60_000);
      }),
    );
  });
});

describe("recurrence rules", () => {
  const ruleFor = (start: Date) =>
    fc
      .record({
        freq: fc.constantFrom("DAILY", "WEEKLY", "MONTHLY", "YEARLY" as const),
        interval: fc.integer({ min: 1, max: 12 }),
        days: fc.subarray([...WEEKDAYS], { minLength: 1 }),
        byNth: fc.boolean(),
        weekStartsOn: fc.option(fc.constantFrom(...WEEKDAYS), { nil: undefined }),
        end: fc.oneof(
          fc.constant({ kind: "never" as const }),
          fc.integer({ min: 1, max: 500 }).map((count) => ({ kind: "count" as const, count })),
          fc.integer({ min: 1, max: 3000 }).map((n) => ({ kind: "until" as const, date: toDateKey(addDays(start, n)) })),
        ),
      })
      .map(
        ({ freq, interval, days, byNth, weekStartsOn, end }): Rule => ({
          freq,
          interval,
          days: freq === "WEEKLY" ? days : [],
          nth: freq === "MONTHLY" && byNth ? monthlyNth(start) : undefined,
          weekStartsOn,
          end,
        }),
      );

  it("a rule written for Google reads back as the same rule", () => {
    fc.assert(
      fc.property(
        noonDate.chain((start) => fc.tuple(fc.constant(start), ruleFor(start), fc.boolean())),
        ([start, rule, allDay]) => {
          const line = formatRule(rule, start, allDay);
          const parsed = parseRecurrence([line], start).rule;
          expect(parsed).not.toBeNull();
          expect(formatRule(parsed!, start, allDay)).toBe(line);
        },
      ),
    );
  });
});

describe("quick add with any text", () => {
  it("never throws and never ends before it starts, in every language", () => {
    const now = new Date(2026, 10, 4, 18, 0);
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.string({ unit: "grapheme" })), fc.constantFrom(...LANGS), (text, lang) => {
        const r = parseQuick(text, now, [], lang);
        expect(r.title).toBe(r.title.trim());
        if (!Number.isNaN(r.start.getTime())) expect(r.end.getTime()).toBeGreaterThanOrEqual(r.start.getTime());
      }),
    );
  });

  it("any clock time written with a colon is the event start", () => {
    const now = new Date(2026, 10, 4, 6, 0);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }), (h, m) => {
        const time = `${h}:${String(m).padStart(2, "0")}`;
        for (const [text, lang] of [
          [`dinner at ${time}`, "en"],
          [`ужин в ${time}`, "ru"],
        ] as const) {
          const r = parseQuick(text, now, [], lang);
          expect([r.start.getHours(), r.start.getMinutes(), r.allDay]).toEqual([h, m, false]);
        }
      }),
    );
  });
});

describe(".ics files", () => {
  const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

  it("escaped text reads back unchanged", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(unescapeText(escape(s))).toBe(s);
      }),
    );
  });

  it("any file content is read without throwing", () => {
    const line = fc.oneof(
      fc.string(),
      fc.constantFrom("BEGIN:VCALENDAR", "END:VCALENDAR", "BEGIN:VEVENT", "END:VEVENT", "BEGIN:VTIMEZONE", "END:VTIMEZONE"),
      fc.tuple(fc.constantFrom("DTSTART", "DTEND", "RRULE", "SUMMARY", "DURATION", "EXDATE", "TZID"), fc.string()).map(([k, v]) => `${k}:${v}`),
    );
    fc.assert(
      fc.property(fc.array(line, { maxLength: 40 }), (lines) => {
        const calendar = parseIcs(lines.join("\r\n"));
        expect(Array.isArray(calendar.events)).toBe(true);
      }),
    );
  });

  it("an event summary survives the file format", () => {
    fc.assert(
      fc.property(fc.string().filter((s) => s.trim() === s && !/[\r\n]/.test(s)), (summary) => {
        const text = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:1", "DTSTART:20261104T090000Z", `SUMMARY:${escape(summary)}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
        expect(parseIcs(text).events[0].summary).toBe(summary);
      }),
    );
  });
});
