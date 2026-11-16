import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type Offset = { x: number; y: number };

/** how much of the window must stay visible so it can be grabbed back */
const KEEP = 80;

/** a drag gesture ends with one of these */
const ENDS = ["pointerup", "pointercancel", "lostpointercapture"] as const;

/** Follows the pointer on the handle until the gesture ends: released, cancelled, or the handle lost the pointer
 *  capture (the window lost focus, the handle was hidden). Returns a function that stops following right away */
export const followPointer = (handle: EventTarget, onMove: (e: PointerEvent) => void): (() => void) => {
  const move = (e: Event) => onMove(e as PointerEvent);
  const stop = () => {
    handle.removeEventListener("pointermove", move);
    for (const end of ENDS) handle.removeEventListener(end, stop);
  };
  handle.addEventListener("pointermove", move);
  for (const end of ENDS) handle.addEventListener(end, stop);
  return stop;
};

/**
 * Dragging a window by a handle (usually the header). Returns a ref for the window,
 * a handler for the handle and a style with the offset. The window doesn't go past the edge so far
 * that its header can't be reached. Pressing buttons in the handle doesn't drag the window.
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
    // where the window would be without the offset
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

  // the gesture in progress: stopped before the next one and when the window unmounts mid-drag
  const stopRef = useRef<(() => void) | null>(null);
  useEffect(() => () => stopRef.current?.(), []);

  // the calendar window was shrunk — bring the settings back into the visible area
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
    stopRef.current?.();
    stopRef.current = followPointer(handle, (ev) => setOffset(clamp({ x: ev.clientX - startX, y: ev.clientY - startY })));
  };

  const style = offset.x || offset.y ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : undefined;

  return { ref, handleProps: { onPointerDown }, style };
};
