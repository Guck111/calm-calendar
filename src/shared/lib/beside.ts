// Where the event card stands: next to the event block it was opened from, like a note pinned beside it.
import type { Box } from "./spatial";

export type Size = { width: number; height: number };
export type Place = { left: number; top: number };

const GAP = 8;
const MARGIN = 12;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** After the block in reading direction, else before it, else under or over it.
 *  null — no side has room: the card stays in the middle of the window */
export const placeBeside = (block: Box, card: Size, viewport: Size, rtl = false): Place | null => {
  const maxLeft = viewport.width - MARGIN - card.width;
  const maxTop = viewport.height - MARGIN - card.height;
  if (maxLeft < MARGIN || maxTop < MARGIN) return null;

  const onRight = block.x + block.width + GAP;
  const onLeft = block.x - GAP - card.width;
  const left = (rtl ? [onLeft, onRight] : [onRight, onLeft]).find((x) => x >= MARGIN && x <= maxLeft);
  if (left !== undefined) return { left, top: clamp(block.y, MARGIN, maxTop) };

  const under = block.y + block.height + GAP;
  const over = block.y - GAP - card.height;
  const top = [under, over].find((y) => y >= MARGIN && y <= maxTop);
  if (top === undefined) return null;
  const sameEdge = rtl ? block.x + block.width - card.width : block.x;
  return { left: clamp(sameEdge, MARGIN, maxLeft), top };
};
