import { describe, expect, it } from "vitest";
import { placeLink } from "./maps";

describe("место встречи на картах", () => {
  it("адрес открывается поиском Google Карт, со всеми знаками адреса", () => {
    const link = placeLink("Kraków, ul. Floriańska 3 & Co");
    expect(link).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
    expect(new URL(link ?? "").searchParams.get("query")).toBe("Kraków, ul. Floriańska 3 & Co");
  });

  it("ссылка в поле «Место» открывается сама, а не ищется на картах", () => {
    expect(placeLink(" https://zoom.us/j/123 ")).toBe("https://zoom.us/j/123");
  });

  it("пустое место — открывать нечего", () => {
    expect(placeLink(undefined)).toBeNull();
    expect(placeLink("   ")).toBeNull();
  });
});
