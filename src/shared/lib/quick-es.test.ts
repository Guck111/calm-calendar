import { describe, expect, it } from "vitest";
import { parseQuick } from "./quick";

// miércoles, 4 de noviembre de 2026, 18:00
const now = new Date(2026, 10, 4, 18, 0);
const calendars = [
  { id: "me", name: "Personal" },
  { id: "work", name: "Trabajo" },
];
const at = (d: number, h: number, m = 0, month = 10) => new Date(2026, month, d, h, m);
const es = (text: string) => parseQuick(text, now, calendars, "es");

describe("quick add in Spanish", () => {
  it("mañana, hora y duración", () => {
    expect(es("mañana a las 19:00 clase de inglés 50 min")).toMatchObject({
      title: "clase de inglés",
      allDay: false,
      start: at(5, 19),
      end: at(5, 19, 50),
    });
    expect(es("reunión mañana a las 9 #trab @Oficina_Centro media hora")).toMatchObject({
      title: "reunión",
      calendarId: "work",
      location: "Oficina Centro",
      start: at(5, 9),
      end: at(5, 9, 30),
    });
  });

  it("«de la mañana» es la mañana, no mañana", () => {
    expect(es("mañana a las 8 de la mañana gimnasio")).toMatchObject({ title: "gimnasio", start: at(5, 8) });
    expect(es("viernes a las 7 de la tarde cena")).toMatchObject({ title: "cena", start: at(6, 19) });
    expect(es("pasado mañana 10:00 dentista").start).toEqual(at(6, 10));
  });

  it("rangos", () => {
    expect(es("llamada de 14 a 15:30 el viernes")).toMatchObject({ title: "llamada", start: at(6, 14), end: at(6, 15, 30) });
    expect(es("hoy 19:00-20:30 yoga").end).toEqual(at(4, 20, 30));
    expect(es("taller de 11 a 1 de la tarde mañana")).toMatchObject({ title: "taller", start: at(5, 11), end: at(5, 13) });
  });

  it("días de la semana: el más cercano; «próximo» salta hoy", () => {
    expect(es("mié 20:00 entrenamiento").start).toEqual(at(4, 20));
    expect(es("el próximo miércoles revisión")).toMatchObject({ title: "revisión", allDay: true, start: at(11, 0) });
    expect(es("miercoles que viene revisión").start).toEqual(at(11, 0));
    expect(es("el sábado cumpleaños de Ana")).toMatchObject({ title: "cumpleaños de Ana", allDay: true, start: at(7, 0) });
  });

  it("fechas; una fecha pasada sin año es del año siguiente", () => {
    expect(es("5 de diciembre 10:00 médico").start).toEqual(at(5, 10, 0, 11));
    expect(es("12/11 corte de pelo")).toMatchObject({ title: "corte de pelo", allDay: true, start: at(12, 0) });
    expect(es("1 de marzo vacaciones").start).toEqual(new Date(2027, 2, 1));
    expect(es("en 3 días 12:00 comida").start).toEqual(at(7, 12));
  });

  it("esta noche, hora sola tras el día, duración", () => {
    expect(es("esta noche a las 9 película")).toMatchObject({ title: "película", start: at(4, 21) });
    expect(es("vie 18 cine 2 h")).toMatchObject({ title: "cine", start: at(6, 18), end: at(6, 20) });
    expect(es("mañana 2h limpieza")).toMatchObject({ title: "limpieza", allDay: true });
    expect(es("a las 19h paseo").start).toEqual(at(4, 19));
    expect(es("almuerzo al mediodía mañana")).toMatchObject({ title: "almuerzo", start: at(5, 12) });
  });

  it("no toca los números del título", () => {
    expect(es("comprar 2 entradas")).toMatchObject({ title: "comprar 2 entradas", allDay: true });
  });
});
