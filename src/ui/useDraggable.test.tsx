// @vitest-environment jsdom
// Dragging a window by its header: listeners don't pile up after a gesture, the window stays reachable
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { followPointer, useDraggable } from "./useDraggable";

const pointer = (type: string, clientX = 0, clientY = 0) => Object.assign(new Event(type), { clientX, clientY });

describe("following the pointer on the handle", () => {
  it.each(["pointerup", "pointercancel", "lostpointercapture"])("stops after %s", (end) => {
    const handle = new EventTarget();
    const moved = vi.fn();
    followPointer(handle, moved);
    handle.dispatchEvent(pointer("pointermove", 10));
    handle.dispatchEvent(pointer(end));
    handle.dispatchEvent(pointer("pointermove", 20));
    expect(moved).toHaveBeenCalledTimes(1);
  });

  it("removes every listener it added", () => {
    const handle = new EventTarget();
    const added = vi.spyOn(handle, "addEventListener");
    const removed = vi.spyOn(handle, "removeEventListener");
    followPointer(handle, vi.fn());
    handle.dispatchEvent(pointer("pointercancel"));
    expect(removed.mock.calls.map(([type]) => type).sort()).toEqual(added.mock.calls.map(([type]) => type).sort());
  });

  it("stops right away when asked (the window unmounts mid-drag)", () => {
    const handle = new EventTarget();
    const moved = vi.fn();
    const stop = followPointer(handle, moved);
    stop();
    handle.dispatchEvent(pointer("pointermove", 10));
    expect(moved).not.toHaveBeenCalled();
  });
});

const Window = () => {
  const { ref, handleProps, style } = useDraggable<HTMLDivElement>();
  return (
    <div ref={ref} style={style} data-testid="window">
      <header data-testid="handle" {...handleProps}>
        <span data-testid="title">Settings</span>
        <button>Close</button>
        <a href="#help">Help</a>
        <input aria-label="Search" />
        <select aria-label="Theme" />
        <textarea aria-label="Note" />
      </header>
    </div>
  );
};

// the window without the offset: 300×200 at (100, 50) in a 1000×800 window
const BASE = { left: 100, top: 50, width: 300, height: 200 };

const offsetOf = (el: HTMLElement) => {
  const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(el.style.transform);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 0, y: 0 };
};

const show = () => {
  render(<Window />);
  const win = screen.getByTestId("window");
  win.getBoundingClientRect = () => {
    const { x, y } = offsetOf(win);
    const left = BASE.left + x;
    const top = BASE.top + y;
    return { x: left, y: top, left, top, width: BASE.width, height: BASE.height, right: left + BASE.width, bottom: top + BASE.height, toJSON: () => ({}) } as DOMRect;
  };
  const handle = screen.getByTestId("handle");
  const captured = vi.fn();
  handle.setPointerCapture = captured;
  return { win, handle, captured };
};

/** press on target at (x, y); returns whether the default action was prevented */
const press = (target: Element, x: number, y: number, button = 0) => {
  const down = Object.assign(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button, clientX: x, clientY: y }), {
    pointerId: 7,
  });
  act(() => void target.dispatchEvent(down));
  return down.defaultPrevented;
};
const move = (handle: Element, x: number, y: number) => act(() => void handle.dispatchEvent(pointer("pointermove", x, y)));
const release = (handle: Element) => act(() => void handle.dispatchEvent(pointer("pointerup")));

const resizeTo = (width: number, height: number) => {
  Object.assign(window, { innerWidth: width, innerHeight: height });
  act(() => void window.dispatchEvent(new Event("resize")));
};

beforeEach(() => Object.assign(window, { innerWidth: 1000, innerHeight: 800 }));
afterEach(cleanup);

describe("dragging a window by its header", () => {
  it("stays put until dragged", () => {
    const { win } = show();
    expect(win.style.transform).toBe("");
  });

  it("follows the pointer from where it was grabbed, across gestures", () => {
    const { win, handle, captured } = show();
    expect(press(screen.getByTestId("title"), 200, 60)).toBe(true);
    expect(captured).toHaveBeenCalledWith(7);
    move(handle, 230, 100);
    expect(offsetOf(win)).toEqual({ x: 30, y: 40 });
    release(handle);
    move(handle, 400, 400);
    expect(offsetOf(win)).toEqual({ x: 30, y: 40 });

    press(handle, 300, 300);
    move(handle, 290, 310);
    expect(offsetOf(win)).toEqual({ x: 20, y: 50 });
  });

  it("returns to no offset when dragged back", () => {
    const { win, handle } = show();
    press(handle, 200, 60);
    move(handle, 210, 60);
    move(handle, 200, 60);
    expect(win.style.transform).toBe("");
    move(handle, 200, 70);
    expect(offsetOf(win)).toEqual({ x: 0, y: 10 });
  });

  it("keeps the header within reach", () => {
    const { win, handle } = show();
    press(handle, 200, 60);
    // 80 px stay visible on either side, the top doesn't go above the window, 48 px stay at the bottom
    move(handle, -5000, -5000);
    expect(offsetOf(win)).toEqual({ x: 80 - BASE.width - BASE.left, y: -BASE.top });
    move(handle, 5000, 5000);
    expect(offsetOf(win)).toEqual({ x: 1000 - 80 - BASE.left, y: 800 - 48 - BASE.top });
  });

  it("is brought back when the calendar window shrinks", () => {
    const { win, handle } = show();
    press(handle, 200, 60);
    move(handle, 700, 560);
    release(handle);
    expect(offsetOf(win)).toEqual({ x: 500, y: 500 });
    resizeTo(500, 400);
    expect(offsetOf(win)).toEqual({ x: 500 - 80 - BASE.left, y: 400 - 48 - BASE.top });
  });

  it("does not start from controls in the header or with another button", () => {
    const { win, handle, captured } = show();
    for (const name of ["Close", "Help"]) expect(press(screen.getByText(name), 200, 60)).toBe(false);
    for (const label of ["Search", "Theme", "Note"]) expect(press(screen.getByLabelText(label), 200, 60)).toBe(false);
    expect(press(handle, 200, 60, 2)).toBe(false);
    move(handle, 300, 300);
    expect(win.style.transform).toBe("");
    expect(captured).not.toHaveBeenCalled();
  });

  it("a new gesture replaces one that never ended", () => {
    const { handle } = show();
    const removed = vi.spyOn(handle, "removeEventListener");
    press(handle, 200, 60);
    press(handle, 200, 60);
    expect(removed).toHaveBeenCalledWith("pointermove", expect.any(Function));
  });

  it("stops following when the window closes mid-drag", () => {
    const { handle } = show();
    const removed = vi.spyOn(handle, "removeEventListener");
    press(handle, 200, 60);
    cleanup();
    expect(removed).toHaveBeenCalledWith("pointermove", expect.any(Function));
  });

  it("moves freely while the window element is not there", () => {
    const Handle = () => {
      const { handleProps, style } = useDraggable<HTMLDivElement>();
      return <header data-testid="handle" style={style} {...handleProps} />;
    };
    render(<Handle />);
    const handle = screen.getByTestId("handle");
    handle.setPointerCapture = vi.fn();
    press(handle, 0, 0);
    move(handle, -5000, 5000);
    expect(offsetOf(handle)).toEqual({ x: -5000, y: 5000 });
  });

  it("stops watching the window size once closed", () => {
    const removed = vi.spyOn(window, "removeEventListener");
    show();
    cleanup();
    expect(removed).toHaveBeenCalledWith("resize", expect.any(Function));
    removed.mockRestore();
  });
});
