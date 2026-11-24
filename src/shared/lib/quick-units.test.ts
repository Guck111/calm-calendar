import { describe, expect, it } from "vitest";
import { parseQuickBe } from "./quick-be";
import { parseQuickRu } from "./quick-ru";
import { parseQuickUk } from "./quick-uk";

// Wednesday, November 4, 2026, 18:00
const now = new Date(2026, 10, 4, 18, 0);
const at = (d: number, h: number) => new Date(2026, 10, d, h, 0);

describe("quick add: a title that only starts like a unit doesn't cancel the hour", () => {
  it("Russian", () => {
    const quick = (input: string) => parseQuickRu(input, now, []);
    expect(quick("завтра 9 чай с Олей")).toMatchObject({ title: "чай с Олей", start: at(5, 9) });
    expect(quick("завтра в 9 чтение")).toMatchObject({ title: "чтение", start: at(5, 9) });
    expect(quick("завтра 9 днюха")).toMatchObject({ title: "днюха", start: at(5, 9) });
    expect(quick("завтра 9 минск")).toMatchObject({ title: "минск", start: at(5, 9) });
  });

  it("Ukrainian", () => {
    const quick = (input: string) => parseQuickUk(input, now, []);
    expect(quick("завтра 9 гра в шахи")).toMatchObject({ title: "гра в шахи", start: at(5, 9) });
    expect(quick("завтра о 9 гра")).toMatchObject({ title: "гра", start: at(5, 9) });
    expect(quick("завтра 9 тижневик")).toMatchObject({ title: "тижневик", start: at(5, 9) });
  });

  it("Belarusian", () => {
    const quick = (input: string) => parseQuickBe(input, now, []);
    expect(quick("заўтра 9 гульня")).toMatchObject({ title: "гульня", start: at(5, 9) });
    expect(quick("заўтра а 9 гульня")).toMatchObject({ title: "гульня", start: at(5, 9) });
    expect(quick("заўтра 9 хвоя")).toMatchObject({ title: "хвоя", start: at(5, 9) });
  });
});

describe("quick add: a real unit after the number is still not an hour", () => {
  it("in each Slavic language", () => {
    expect(parseQuickRu("завтра 2 часа дорога", now, [])).toMatchObject({ title: "дорога", allDay: true });
    expect(parseQuickRu("завтра в 2 ч дорога", now, []).allDay).toBe(true);
    expect(parseQuickUk("завтра 2 години дорога", now, [])).toMatchObject({ title: "дорога", allDay: true });
    expect(parseQuickBe("заўтра 2 гадзіны дарога", now, [])).toMatchObject({ title: "дарога", allDay: true });
  });
});
