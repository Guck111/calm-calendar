import { describe, expect, it } from "vitest";
import { parseQuick } from "./quick";

// Mittwoch, 4. November 2026, 18:00
const now = new Date(2026, 10, 4, 18, 0);
const calendars = [
  { id: "me", name: "Privat" },
  { id: "work", name: "Arbeit" },
];
const at = (d: number, h: number, m = 0, month = 10) => new Date(2026, month, d, h, m);
const de = (text: string) => parseQuick(text, now, calendars, "de");

describe("quick add in German", () => {
  it("morgen, Uhrzeit und Dauer", () => {
    expect(de("morgen 19 Uhr Englischkurs 50 min")).toMatchObject({
      title: "Englischkurs",
      allDay: false,
      start: at(5, 19),
      end: at(5, 19, 50),
    });
    expect(de("Meeting morgen um 9 #arb @Büro_Mitte halbe Stunde")).toMatchObject({
      title: "Meeting",
      calendarId: "work",
      location: "Büro Mitte",
      start: at(5, 9),
      end: at(5, 9, 30),
    });
  });

  it("Tageszeiten und Zeiträume", () => {
    expect(de("Freitag um 7 abends Essen")).toMatchObject({ title: "Essen", start: at(6, 19) });
    expect(de("Anruf von 14 bis 15:30 Uhr am Freitag")).toMatchObject({ title: "Anruf", start: at(6, 14), end: at(6, 15, 30) });
    expect(de("heute 19:00-20:30 Yoga").end).toEqual(at(4, 20, 30));
    expect(de("heute Abend um 8 Film")).toMatchObject({ title: "Film", start: at(4, 20) });
    expect(de("um 19.30 Uhr Spaziergang").start).toEqual(at(4, 19, 30));
  });

  it("Wochentage: der nächste, «nächsten» überspringt heute", () => {
    expect(de("Mi 20 Uhr Training").start).toEqual(at(4, 20));
    expect(de("nächsten Mittwoch Review")).toMatchObject({ title: "Review", allDay: true, start: at(11, 0) });
    expect(de("am Samstag Geburtstag von Lena")).toMatchObject({ title: "Geburtstag von Lena", allDay: true, start: at(7, 0) });
    expect(de("so wie besprochen")).toMatchObject({ title: "so wie besprochen", allDay: true, start: at(4, 0) });
  });

  it("Daten; ein vergangenes Datum ohne Jahr ist im nächsten Jahr", () => {
    expect(de("5. Dezember 10 Uhr Zahnarzt").start).toEqual(at(5, 10, 0, 11));
    expect(de("12.11. Friseur")).toMatchObject({ title: "Friseur", allDay: true, start: at(12, 0) });
    expect(de("1. März Urlaub")).toMatchObject({ title: "Urlaub", start: new Date(2027, 2, 1) });
    expect(de("in 3 Tagen 12 Uhr Mittagessen")).toMatchObject({ title: "Mittagessen", start: at(7, 12) });
    expect(de("übermorgen 10:00 Bank").start).toEqual(at(6, 10));
  });

  it("Stunde direkt nach dem Tag; Dauer", () => {
    expect(de("Fr 18 Kino 2 Std")).toMatchObject({ title: "Kino", start: at(6, 18), end: at(6, 20) });
    expect(de("morgen 2 Stunden Putzen")).toMatchObject({ title: "Putzen", allDay: true });
  });

  it("lässt Zahlen im Titel in Ruhe", () => {
    expect(de("2 Tickets kaufen")).toMatchObject({ title: "2 Tickets kaufen", allDay: true });
  });
});
