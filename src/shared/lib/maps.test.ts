import { describe, expect, it } from "vitest";
import { placeLink } from "./maps";

describe("meeting location on maps", () => {
  it("an address opens as a Google Maps search, with all address characters", () => {
    const link = placeLink("Kraków, ul. Floriańska 3 & Co");
    expect(link).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
    expect(new URL(link ?? "").searchParams.get("query")).toBe("Kraków, ul. Floriańska 3 & Co");
  });

  it("a link in the 'Location' field opens as is, not searched on maps", () => {
    expect(placeLink(" https://zoom.us/j/123 ")).toBe("https://zoom.us/j/123");
  });

  it("empty location — nothing to open", () => {
    expect(placeLink(undefined)).toBeNull();
    expect(placeLink("   ")).toBeNull();
  });
});
