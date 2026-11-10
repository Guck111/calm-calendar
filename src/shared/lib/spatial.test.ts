// Arrow keys between event blocks: the nearest block in that direction on screen
import { describe, expect, it } from "vitest";
import { nearest, type Box } from "./spatial";

// a week grid: Mon 9:00, Mon 14:00, Tue 10:00, Wed 9:00 (columns 100 px wide, 1 px a minute)
const box = (x: number, y: number, w = 90, h = 50): Box => ({ x, y, width: w, height: h });
const mon9 = box(0, 540);
const mon14 = box(0, 840);
const tue10 = box(100, 600);
const wed9 = box(200, 540);
const all = [mon9, mon14, tue10, wed9];

describe("nearest block in a direction", () => {
  it("down and up stay in the column", () => {
    expect(nearest(mon9, all, "down")).toBe(mon14);
    expect(nearest(mon14, all, "up")).toBe(mon9);
  });

  it("right goes to the next day, the block closest in time", () => {
    expect(nearest(mon9, all, "right")).toBe(tue10);
    expect(nearest(tue10, all, "right")).toBe(wed9);
    expect(nearest(wed9, all, "left")).toBe(tue10);
  });

  it("nothing in that direction", () => {
    expect(nearest(mon9, all, "left")).toBeNull();
    expect(nearest(mon9, all, "up")).toBeNull();
    expect(nearest(wed9, all, "right")).toBeNull();
  });

  it("a list (Schedule): down is the next row even if it is shorter", () => {
    const rows = [box(0, 0, 600, 30), box(0, 40, 300, 30), box(0, 80, 600, 30)];
    expect(nearest(rows[0], rows, "down")).toBe(rows[1]);
    expect(nearest(rows[1], rows, "down")).toBe(rows[2]);
  });
});
