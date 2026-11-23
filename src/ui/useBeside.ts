// Keeps the event card next to the block of its event while the card, the window or the block change size.
import { useLayoutEffect, useRef, useState } from "react";
import { placeBeside, type Place } from "../shared/lib/beside";

const onScreen = (el: HTMLElement) => {
  const r = el.getBoundingClientRect();
  return el.isConnected && r.width > 0 && r.height > 0;
};

/** The block the card was opened from: the focused one (an event over several days has several), else the first on screen */
const blockOf = (key: string): HTMLElement | null => {
  const focused = document.activeElement?.closest<HTMLElement>("[data-event-key]");
  if (focused?.dataset.eventKey === key) return focused;
  const all = [...document.querySelectorAll<HTMLElement>("main [data-event-key]")];
  return all.find((b) => b.dataset.eventKey === key && onScreen(b)) ?? null;
};

/** eventKey: the event whose card is open, null — nothing to stand next to (a form, a new event) */
export const useBeside = (eventKey: string | null) => {
  const card = useRef<HTMLDivElement>(null);
  // found while rendering: when the card mounts, the focus has already left the block for the card
  const [anchor, setAnchor] = useState<{ key: string; block: HTMLElement | null } | null>(null);
  if ((anchor?.key ?? null) !== eventKey) setAnchor(eventKey ? { key: eventKey, block: blockOf(eventKey) } : null);
  const [place, setPlace] = useState<Place | null>(null);

  const block = anchor?.block ?? null;
  useLayoutEffect(() => {
    const node = card.current;
    if (!block || !node) return setPlace(null);
    const update = () =>
      setPlace(
        onScreen(block)
          ? placeBeside(
              block.getBoundingClientRect(),
              { width: node.offsetWidth, height: node.offsetHeight },
              { width: window.innerWidth, height: window.innerHeight },
              document.documentElement.dir === "rtl",
            )
          : null,
      );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [block]);

  return { card, place: block ? place : null };
};
