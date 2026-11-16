// Events without a mouse. Event blocks in all views are buttons with data-event-key: Tab and Enter work by themselves.
// Here: arrows between blocks (nearest on screen), ↓/↑ — enter events, E — edit,
// Ctrl+D — duplicate, Delete — card asking to confirm deletion. After the card, focus returns to the event.
import { useUnit } from "effector-react";
import { useEffect, useRef } from "react";
import { $draft, $opened } from "../model/editor";
import { eventKeyPressed, type EventKeyAction } from "../model/keyboard";
import { nearest, type Direction } from "../shared/lib/spatial";

const ARROWS: Record<string, Direction> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

/** Focused event block (or one containing focus) */
export const eventElement = (target: EventTarget | null): HTMLElement | null =>
  target instanceof Element ? target.closest<HTMLElement>("[data-event-key]") : null;

/** Visible event blocks of the current view, in document order */
const blocks = (): HTMLElement[] =>
  [...document.querySelectorAll<HTMLElement>("main [data-event-key]")].filter((b) => {
    const r = b.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

export const useEventKeys = (signedIn: boolean) => {
  const [press, opened, draft] = useUnit([eventKeyPressed, $opened, $draft]);
  // event from which the card was opened via keyboard: focus returns to it
  const back = useRef<string | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    const onKey = (e: KeyboardEvent) => {
      // a card, form, command menu or settings are open — keys belong to them
      if (document.querySelector('[role="dialog"]')) return;
      const mods = e.ctrlKey || e.metaKey || e.altKey || e.shiftKey;
      const el = eventElement(e.target);
      const key = el?.dataset.eventKey;

      if (!el || !key) {
        // no event selected: ↓ — first, ↑ — last
        if (mods || isTyping(e.target) || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
        const list = blocks();
        const target = e.key === "ArrowDown" ? list[0] : list[list.length - 1];
        if (target) {
          e.preventDefault();
          target.focus();
        }
        return;
      }

      const act = (action: EventKeyAction) => {
        e.preventDefault();
        back.current = key;
        press({ key, action });
      };
      const direction = ARROWS[e.key];
      if (direction && !mods) {
        e.preventDefault();
        const list = blocks();
        const boxes = list.map((b) => b.getBoundingClientRect());
        const from = boxes[list.indexOf(el)] ?? el.getBoundingClientRect();
        const to = nearest(from, boxes, direction);
        if (to) list[boxes.indexOf(to)]?.focus();
      } else if ((e.key === "Enter" || e.key === " ") && !mods) {
        // the button itself opens the card; remember where to return focus
        back.current = key;
      } else if (e.code === "KeyE" && !mods) act("edit");
      else if (e.code === "KeyD" && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) act("duplicate");
      else if (e.key === "Delete" && !mods) act("delete");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [signedIn, press]);

  // card and form closed — focus the same event if it is still on screen
  useEffect(() => {
    if (opened || draft || !back.current) return;
    const key = back.current;
    back.current = null;
    requestAnimationFrame(() => blocks().find((b) => b.dataset.eventKey === key)?.focus());
  }, [opened, draft]);
};
