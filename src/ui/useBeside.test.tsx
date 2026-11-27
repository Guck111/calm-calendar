// @vitest-environment jsdom
// The event card stands next to the block it was opened from and follows it when sizes change
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { placeBeside } from "../shared/lib/beside";
import { useBeside } from "./useBeside";

const CARD = { width: 320, height: 240 };
const VIEWPORT = { width: 1200, height: 800 };

const Card = ({ eventKey }: { eventKey: string | null }) => {
  const { card, place } = useBeside(eventKey);
  return <div ref={card} data-testid="card" data-place={place ? `${place.left},${place.top}` : "none"} />;
};

type Rect = { x: number; y: number; width?: number; height?: number };

const setRect = (el: HTMLElement, { x, y, width = 100, height = 40 }: Rect) => {
  el.getBoundingClientRect = () =>
    ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height, toJSON: () => ({}) }) as DOMRect;
};

const block = (key: string, rect: Rect, parent: HTMLElement = document.querySelector("main")!) => {
  const el = document.createElement("button");
  el.dataset.eventKey = key;
  setRect(el, rect);
  parent.append(el);
  return el;
};

/** where the card should stand next to this block */
const beside = (rect: Rect, rtl = false) => {
  const { x, y, width = 100, height = 40 } = rect;
  const place = placeBeside({ x, y, width, height }, CARD, VIEWPORT, rtl)!;
  return `${place.left},${place.top}`;
};

const placed = () => screen.getByTestId("card").dataset.place;

let observers: { update: () => void; observed: Element[]; disconnected: boolean }[] = [];

beforeEach(() => {
  observers = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      entry = { update: () => {}, observed: [] as Element[], disconnected: false };
      constructor(update: () => void) {
        this.entry.update = update;
        observers.push(this.entry);
      }
      observe(el: Element) {
        this.entry.observed.push(el);
      }
      disconnect() {
        this.entry.disconnected = true;
      }
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(CARD.width);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(CARD.height);
  Object.assign(window, { innerWidth: VIEWPORT.width, innerHeight: VIEWPORT.height });
  document.body.append(document.createElement("main"));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  document.documentElement.dir = "ltr";
});

describe("the card beside its event", () => {
  it("stands nowhere in particular without an event", () => {
    block("a", { x: 100, y: 100 });
    render(<Card eventKey={null} />);
    expect(placed()).toBe("none");
  });

  it("stands next to the first block of the event on screen", () => {
    block("other", { x: 500, y: 500 });
    block("a", { x: 100, y: 100, width: 0 });
    block("a", { x: 100, y: 100, height: 0 });
    block("a", { x: 200, y: 300 });
    block("a", { x: 600, y: 300 });
    render(<Card eventKey="a" />);
    expect(placed()).toBe(beside({ x: 200, y: 300 }));
  });

  it("prefers the focused block of an event over several days", () => {
    block("a", { x: 200, y: 300 });
    block("a", { x: 600, y: 100 }).focus();
    render(<Card eventKey="a" />);
    expect(placed()).toBe(beside({ x: 600, y: 100 }));
  });

  it("ignores a focused block of another event", () => {
    block("a", { x: 200, y: 300 });
    block("b", { x: 600, y: 100 }).focus();
    render(<Card eventKey="a" />);
    expect(placed()).toBe(beside({ x: 200, y: 300 }));
  });

  it("looks for blocks only in the view", () => {
    block("a", { x: 200, y: 300 }, document.body);
    render(<Card eventKey="a" />);
    expect(placed()).toBe("none");
  });

  it("opens on the other side in right-to-left languages", () => {
    document.documentElement.dir = "rtl";
    block("a", { x: 500, y: 300 });
    render(<Card eventKey="a" />);
    expect(placed()).toBe(beside({ x: 500, y: 300 }, true));
    expect(placed()).not.toBe(beside({ x: 500, y: 300 }));
  });

  it("follows the block when the card or the window change size, and lets go when it is hidden", () => {
    const el = block("a", { x: 200, y: 300 });
    render(<Card eventKey="a" />);
    const [observer] = observers;
    expect(observer.observed).toEqual([screen.getByTestId("card")]);

    setRect(el, { x: 250, y: 320 });
    act(() => observer.update());
    expect(placed()).toBe(beside({ x: 250, y: 320 }));

    setRect(el, { x: 100, y: 120 });
    act(() => void window.dispatchEvent(new Event("resize")));
    expect(placed()).toBe(beside({ x: 100, y: 120 }));

    setRect(el, { x: 100, y: 120, width: 0 });
    act(() => observer.update());
    expect(placed()).toBe("none");

    setRect(el, { x: 100, y: 120 });
    el.remove();
    act(() => observer.update());
    expect(placed()).toBe("none");
  });

  it("moves to the block of another event, and stops following the old one", () => {
    block("a", { x: 200, y: 300 });
    block("b", { x: 600, y: 100 });
    const { rerender } = render(<Card eventKey="a" />);
    rerender(<Card eventKey="b" />);
    expect(placed()).toBe(beside({ x: 600, y: 100 }));
    expect(observers.map((o) => o.disconnected)).toEqual([true, false]);
    rerender(<Card eventKey={null} />);
    expect(placed()).toBe("none");
  });

  it("stops following once the card closes", () => {
    block("a", { x: 200, y: 300 });
    const removed = vi.spyOn(window, "removeEventListener");
    render(<Card eventKey="a" />);
    cleanup();
    expect(observers[0].disconnected).toBe(true);
    expect(removed).toHaveBeenCalledWith("resize", expect.any(Function));
  });
});
