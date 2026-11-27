import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "../i18n";
import { HOLIDAYS_KEY, HOLIDAY_REGIONS, holidayCalendar, isHolidayRegion, regionName } from "./holidays";
import type { Calendar } from "../api/types";

afterEach(() => setLang("ru"));

describe("holiday regions", () => {
  it("every country has its own Google calendar name", () => {
    const names = Object.values(HOLIDAY_REGIONS);
    expect(names.every((name) => /^[a-z_]+$/.test(name))).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  it("the stored setting keeps its key", () => {
    expect(HOLIDAYS_KEY).toBe("calm.holidays");
  });

  it("only a known country code is a region, not object keys or a list", () => {
    expect(isHolidayRegion("toString")).toBe(false);
    expect(isHolidayRegion(["RU"])).toBe(false);
  });

  it("the country name is in the app language, an unknown code stays as it is", () => {
    expect(regionName("PL")).toBe("Польша");
    setLang("en", "en-GB");
    expect(regionName("PL")).toBe("Poland");
    expect(regionName("x")).toBe("x");
  });
});

describe("holiday calendar", () => {
  const google = (googleId: string) => ({ googleId }) as Calendar;

  it("is read through the first account with Google's holiday look", () => {
    expect(holidayCalendar("PL", ["a@x", "b@x"], [])).toEqual({
      id: "a@x\u0000ru.polish#holiday@group.v.calendar.google.com",
      googleId: "ru.polish#holiday@group.v.calendar.google.com",
      account: "a@x",
      name: "Польша",
      color: "#16a765",
      textColor: "#000000",
      accessRole: "reader",
      primary: false,
      selected: true,
      defaultReminders: [],
      holiday: true,
    });
  });

  it("is not added again when the Google list already has it in any language", () => {
    expect(holidayCalendar("PL", ["a@x"], [google("en.polish#holiday@group.v.calendar.google.com")])).toBeNull();
    expect(holidayCalendar("PL", ["a@x"], [google("en.usa#holiday@group.v.calendar.google.com")])).not.toBeNull();
  });
});
