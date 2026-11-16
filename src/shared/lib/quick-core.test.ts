import { describe, expect, it } from "vitest";
import { normalizeInput } from "./quick-core";

describe("normalizeInput", () => {
  it("turns digits of other scripts into 0–9", () => {
    expect(normalizeInput("٧:٣٠")).toBe("7:30"); // Arabic
    expect(normalizeInput("۱۲")).toBe("12"); // Persian
    expect(normalizeInput("१०:१५")).toBe("10:15"); // Devanagari
    expect(normalizeInput("৯টা")).toBe("9টা"); // Bengali
    expect(normalizeInput("１９：００")).toBe("19:00"); // full-width
  });

  it("keeps letters and ordinary text", () => {
    expect(normalizeInput("завтра 19:00 #работа")).toBe("завтра 19:00 #работа");
    expect(normalizeInput("＃仕事　＠渋谷")).toBe("#仕事 @渋谷");
  });
});
