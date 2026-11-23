import { describe, expect, it } from "vitest";
import { placeBeside } from "./beside";

const viewport = { width: 1280, height: 800 };
const card = { width: 480, height: 300 };
const block = (x: number, y: number, width = 140, height = 60) => ({ x, y, width, height });

describe("event card next to its event", () => {
  it("stands after the event, level with its top", () => {
    expect(placeBeside(block(400, 200), card, viewport)).toEqual({ left: 548, top: 200 });
  });

  it("moves before the event when there is no room after it", () => {
    expect(placeBeside(block(1100, 200), card, viewport)).toEqual({ left: 612, top: 200 });
  });

  it("right-to-left: before the event on screen first, then after it", () => {
    expect(placeBeside(block(700, 200), card, viewport, true)).toEqual({ left: 212, top: 200 });
    expect(placeBeside(block(300, 200), card, viewport, true)).toEqual({ left: 448, top: 200 });
  });

  it("stays inside the window for an event at the bottom or above the top edge", () => {
    expect(placeBeside(block(400, 760), card, viewport)).toEqual({ left: 548, top: 488 });
    expect(placeBeside(block(400, -40), card, viewport)).toEqual({ left: 548, top: 12 });
  });

  it("goes under a wide event, or over it at the bottom of the window", () => {
    expect(placeBeside(block(300, 100, 900, 24), card, viewport)).toEqual({ left: 300, top: 132 });
    expect(placeBeside(block(300, 700, 900, 24), card, viewport)).toEqual({ left: 300, top: 392 });
  });

  it("right-to-left: under a wide event the card keeps to its right edge", () => {
    expect(placeBeside(block(100, 100, 900, 24), card, viewport, true)).toEqual({ left: 520, top: 132 });
  });

  it("has no place in a window smaller than the card or around an event that fills it", () => {
    expect(placeBeside(block(100, 100), card, { width: 400, height: 800 })).toBeNull();
    expect(placeBeside(block(100, 100), card, { width: 1280, height: 280 })).toBeNull();
    expect(placeBeside(block(200, 200, 900, 400), card, viewport)).toBeNull();
  });
});
