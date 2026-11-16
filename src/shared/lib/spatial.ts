// Arrows between event blocks: the nearest block in that direction on screen.
// Works the same in the week grid, month and list, and right-to-left too: we look at the screen, not at dates.

export type Box = { x: number; y: number; width: number; height: number };
export type Direction = "up" | "down" | "left" | "right";

const center = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** Gap between segments [a1, a2] and [b1, b2]; 0 — they overlap */
const gap = (a1: number, a2: number, b1: number, b2: number) => Math.max(0, b1 - a2, a1 - b2);

/** Nearest block in direction; null — nothing further that way.
 *  Up and down — first blocks in the same column (overlapping horizontally), then the nearest.
 *  Left and right — first the nearest column, in it the block closest in height (by time) */
export const nearest = <T extends Box>(from: Box, boxes: T[], direction: Direction): T | null => {
  const c = center(from);
  const vertical = direction === "up" || direction === "down";
  let best: T | null = null;
  let bestScore = Infinity;
  for (const box of boxes) {
    if (box === from) continue;
    const d = center(box);
    const dx = d.x - c.x;
    const dy = d.y - c.y;
    const along = direction === "right" ? dx : direction === "left" ? -dx : direction === "down" ? dy : -dy;
    if (along < 0.5) continue;
    let score: number;
    if (vertical) {
      const side = gap(from.x, from.x + from.width, box.x, box.x + box.width);
      score = (side > 0 ? 1e6 + side : 0) + along;
    } else {
      // an adjacent column, not the same one: the center is shifted by at least half a width
      if (Math.abs(dx) < from.width / 2) continue;
      score = along * 1000 + gap(from.y, from.y + from.height, box.y, box.y + box.height);
    }
    if (score < bestScore) {
      bestScore = score;
      best = box;
    }
  }
  return best;
};
