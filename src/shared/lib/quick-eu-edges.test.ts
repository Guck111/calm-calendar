import { describe, expect, it } from "vitest";
import { parseQuickDe } from "./quick-de";
import { parseQuickEs } from "./quick-es";
import { parseQuickFr } from "./quick-fr";

// Wednesday, November 4, 2026, 18:00
const now = new Date(2026, 10, 4, 18, 0);
const at = (d: number, h = 0, m = 0, month = 10, y = 2026) => new Date(y, month, d, h, m);
const de = (input: string) => parseQuickDe(input, now, []);
const es = (input: string) => parseQuickEs(input, now, []);
const fr = (input: string) => parseQuickFr(input, now, []);

describe("European quick add: dates", () => {
  it("a named date with a year, January included", () => {
    expect(de("5. Dezember 2027 Zahnarzt").start).toEqual(at(5, 0, 0, 11, 2027));
    expect(de("3. Januar Termin").start).toEqual(at(3, 0, 0, 0, 2027));
  });

  it("a numeric date with a two-digit year", () => {
    expect(es("5/12/27 cena").start).toEqual(at(5, 0, 0, 11, 2027));
  });

  it("today keeps a time that has passed, in some weeks counts weeks", () => {
    expect(de("heute 10 Uhr Arzt").start).toEqual(at(4, 10));
    expect(de("in 2 Wochen Review").start).toEqual(at(18));
    expect(es("en 2 semanas revisión").start).toEqual(at(18));
  });

  it("a title with the word 'undefined' is not a weekday", () => {
    expect(de("undefined Vortrag").start).toEqual(at(4));
  });

  it("a weekday followed by a date is not a bare hour", () => {
    expect(es("lunes 13 de marzo examen")).toMatchObject({ allDay: true, start: at(13, 0, 0, 2, 2027) });
  });
});

describe("European quick add: times", () => {
  it("parts of the day are read in any case, 12 in the morning is midnight, 12 at noon stays", () => {
    expect(de("Freitag um 7 Abends Essen").start).toEqual(at(6, 19));
    expect(fr("demain 12h du matin vol").start).toEqual(at(5, 0));
    expect(es("mañana a las 12 del mediodía comida").start).toEqual(at(5, 12));
  });

  it("midnight is a time", () => {
    expect(de("morgen Mitternacht Start")).toMatchObject({ title: "Start", allDay: false, start: at(5, 0) });
  });

  it("a range within one hour takes the end's part of the day", () => {
    expect(es("mañana de 1 a 1:30 de la tarde reunión")).toMatchObject({ start: at(5, 13), end: at(5, 13, 30) });
  });

  it("impossible ranges and hours leave the event all-day", () => {
    expect(de("morgen 9-25 Leute").allDay).toBe(true);
    expect(de("morgen 25 Uhr Party").allDay).toBe(true);
  });

  it("an hour with a part of the day and no preposition", () => {
    expect(es("cena 7 de la tarde mañana").start).toEqual(at(5, 19));
  });

  it("the time written first wins over a later duration", () => {
    expect(fr("demain 9h sport 1h30")).toMatchObject({ start: at(5, 9), end: at(5, 10, 30) });
  });

  it("a bare hour after a named date", () => {
    expect(de("6. November 10 Termin").start).toEqual(at(6, 10));
  });
});

describe("European quick add: durations", () => {
  it("fractional hours with a comma", () => {
    expect(de("morgen 9 Uhr Workshop 1,5 Std").end).toEqual(at(5, 10, 30));
  });
});
