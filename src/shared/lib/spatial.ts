// Стрелки между блоками событий: ближайший блок в эту сторону на экране.
// Работает одинаково в сетке недели, месяце и списке, и справа налево тоже: смотрим на экран, а не на даты.

export type Box = { x: number; y: number; width: number; height: number };
export type Direction = "up" | "down" | "left" | "right";

const center = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** Зазор между отрезками [a1, a2] и [b1, b2]; 0 — перекрываются */
const gap = (a1: number, a2: number, b1: number, b2: number) => Math.max(0, b1 - a2, a1 - b2);

/** Ближайший блок в сторону direction; null — дальше в эту сторону ничего нет.
 *  Вверх и вниз — сначала блоки в том же столбце (перекрываются по горизонтали), потом ближайший.
 *  Влево и вправо — сначала ближайший столбец, в нём — блок ближе всего по высоте (по времени) */
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
      // соседний столбец, а не тот же: центр сдвинут хотя бы на полширины
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
