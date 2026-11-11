import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type Offset = { x: number; y: number };

/** сколько окна должно оставаться видно, чтобы его можно было ухватить обратно */
const KEEP = 80;

/**
 * Перетаскивание окна за ручку (обычно шапку). Возвращает ref для окна,
 * обработчик для ручки и стиль со сдвигом. Окно не уходит за край так,
 * что его шапку уже не достать. Нажатие на кнопки в ручке не тянет окно.
 */
export const useDraggable = <T extends HTMLElement>() => {
  const ref = useRef<T>(null);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const offsetRef = useRef(offset);
  offsetRef.current = offset;

  const clamp = useCallback((next: Offset): Offset => {
    const el = ref.current;
    if (!el) return next;
    const r = el.getBoundingClientRect();
    // где окно стояло бы без сдвига
    const baseLeft = r.left - offsetRef.current.x;
    const baseTop = r.top - offsetRef.current.y;
    const minX = KEEP - r.width - baseLeft;
    const maxX = window.innerWidth - KEEP - baseLeft;
    const minY = -baseTop;
    const maxY = window.innerHeight - 48 - baseTop;
    return {
      x: Math.min(Math.max(next.x, minX), maxX),
      y: Math.min(Math.max(next.y, minY), maxY),
    };
  }, []);

  // окно календаря уменьшили — возвращаем настройки в видимую часть
  useEffect(() => {
    const onResize = () => setOffset((o) => clamp(o));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clamp]);

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, a, input, select, textarea")) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX - offsetRef.current.x;
    const startY = e.clientY - offsetRef.current.y;
    const move = (ev: PointerEvent) => setOffset(clamp({ x: ev.clientX - startX, y: ev.clientY - startY }));
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  const style = offset.x || offset.y ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : undefined;

  return { ref, handleProps: { onPointerDown }, style };
};
