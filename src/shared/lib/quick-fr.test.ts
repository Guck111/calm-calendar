import { describe, expect, it } from "vitest";
import { parseQuick } from "./quick";

// mercredi 4 novembre 2026, 18:00
const now = new Date(2026, 10, 4, 18, 0);
const calendars = [
  { id: "me", name: "Perso" },
  { id: "work", name: "Travail" },
];
const at = (d: number, h: number, m = 0, month = 10) => new Date(2026, month, d, h, m);
const fr = (text: string) => parseQuick(text, now, calendars, "fr");

describe("quick add in French", () => {
  it("demain, heure et durée", () => {
    expect(fr("demain 19h cours d'anglais 50 min")).toMatchObject({
      title: "cours d'anglais",
      allDay: false,
      start: at(5, 19),
      end: at(5, 19, 50),
    });
    expect(fr("réunion demain à 9h #trav @Bureau_Centre une demi-heure")).toMatchObject({
      title: "réunion",
      calendarId: "work",
      location: "Bureau Centre",
      start: at(5, 9),
      end: at(5, 9, 30),
    });
  });

  it("parties de la journée et plages", () => {
    expect(fr("vendredi à 7h du soir dîner")).toMatchObject({ title: "dîner", start: at(6, 19) });
    expect(fr("appel de 14h à 15h30 vendredi")).toMatchObject({ title: "appel", start: at(6, 14), end: at(6, 15, 30) });
    expect(fr("aujourd’hui 19:00-20:30 yoga").end).toEqual(at(4, 20, 30));
    expect(fr("ce soir à 8 film")).toMatchObject({ title: "film", start: at(4, 20) });
    expect(fr("déjeuner à midi demain")).toMatchObject({ title: "déjeuner", start: at(5, 12) });
  });

  it("jours de la semaine : le plus proche ; «prochain» saute aujourd'hui", () => {
    expect(fr("mer 20h entraînement").start).toEqual(at(4, 20));
    expect(fr("mercredi prochain revue")).toMatchObject({ title: "revue", allDay: true, start: at(11, 0) });
    expect(fr("le samedi anniversaire de Léa")).toMatchObject({ title: "anniversaire de Léa", allDay: true, start: at(7, 0) });
  });

  it("dates ; une date passée sans année est l'an prochain", () => {
    expect(fr("5 décembre 10h dentiste").start).toEqual(at(5, 10, 0, 11));
    expect(fr("12/11 coiffeur")).toMatchObject({ title: "coiffeur", allDay: true, start: at(12, 0) });
    expect(fr("le 1er mars vacances")).toMatchObject({ title: "vacances", start: new Date(2027, 2, 1) });
    expect(fr("dans 3 jours 12h déjeuner").start).toEqual(at(7, 12));
    expect(fr("après-demain 10:00 banque").start).toEqual(at(6, 10));
  });

  it("heure seule après le jour ; durées", () => {
    expect(fr("ven 18 ciné pendant 2h")).toMatchObject({ title: "ciné", start: at(6, 18), end: at(6, 20) });
    expect(fr("demain pendant 2h ménage")).toMatchObject({ title: "ménage", allDay: true });
    expect(fr("demain 9h sport 1h30").end).toEqual(at(5, 10, 30));
  });

  it("ne touche pas aux nombres du titre", () => {
    expect(fr("acheter 2 billets")).toMatchObject({ title: "acheter 2 billets", allDay: true });
  });
});
