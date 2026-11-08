import { describe, expect, it } from "vitest";
import { parseQuick } from "./quick";

// quarta-feira, 4 de novembro de 2026, 18:00
const now = new Date(2026, 10, 4, 18, 0);
const calendars = [
  { id: "me", name: "Pessoal" },
  { id: "work", name: "Trabalho" },
];
const at = (d: number, h: number, m = 0, month = 10) => new Date(2026, month, d, h, m);
const pt = (text: string) => parseQuick(text, now, calendars, "pt");

describe("quick add in Portuguese", () => {
  it("amanhã, horário e duração", () => {
    expect(pt("amanhã 19h aula de inglês 50 min")).toMatchObject({
      title: "aula de inglês",
      allDay: false,
      start: at(5, 19),
      end: at(5, 19, 50),
    });
    expect(pt("reunião amanhã às 9h #trab @Escritório_Centro meia hora")).toMatchObject({
      title: "reunião",
      calendarId: "work",
      location: "Escritório Centro",
      start: at(5, 9),
      end: at(5, 9, 30),
    });
  });

  it("partes do dia e intervalos", () => {
    expect(pt("sexta às 7 da noite jantar")).toMatchObject({ title: "jantar", start: at(6, 19) });
    expect(pt("ligação das 14h às 15h30 na sexta")).toMatchObject({ title: "ligação", start: at(6, 14), end: at(6, 15, 30) });
    expect(pt("hoje 19:00-20:30 ioga").end).toEqual(at(4, 20, 30));
    expect(pt("hoje à noite às 8 filme")).toMatchObject({ title: "filme", start: at(4, 20) });
    expect(pt("almoço ao meio-dia amanhã")).toMatchObject({ title: "almoço", start: at(5, 12) });
  });

  it("dias da semana: o mais próximo; «próxima» pula hoje", () => {
    expect(pt("qua 20h treino").start).toEqual(at(4, 20));
    expect(pt("próxima quarta-feira revisão")).toMatchObject({ title: "revisão", allDay: true, start: at(11, 0) });
    expect(pt("quarta que vem revisão").start).toEqual(at(11, 0));
    expect(pt("no sábado aniversário da Ana")).toMatchObject({ title: "aniversário da Ana", allDay: true, start: at(7, 0) });
    expect(pt("terça 10h dentista").start).toEqual(at(10, 10));
  });

  it("datas; data passada sem ano é do ano seguinte", () => {
    expect(pt("5 de dezembro 10h médico").start).toEqual(at(5, 10, 0, 11));
    expect(pt("12/11 cabeleireiro")).toMatchObject({ title: "cabeleireiro", allDay: true, start: at(12, 0) });
    expect(pt("1 de março férias").start).toEqual(new Date(2027, 2, 1));
    expect(pt("daqui a 3 dias 12h almoço").start).toEqual(at(7, 12));
    expect(pt("depois de amanhã 10:00 banco").start).toEqual(at(6, 10));
  });

  it("hora solta depois do dia; durações", () => {
    expect(pt("sex 18 cinema durante 2h")).toMatchObject({ title: "cinema", start: at(6, 18), end: at(6, 20) });
    expect(pt("amanhã 2 horas faxina")).toMatchObject({ title: "faxina", allDay: true });
  });

  it("não mexe nos números do título", () => {
    expect(pt("comprar 2 ingressos")).toMatchObject({ title: "comprar 2 ingressos", allDay: true });
  });
});
