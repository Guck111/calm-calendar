// Dragging a window by its header: listeners don't pile up after a gesture
import { describe, expect, it, vi } from "vitest";
import { followPointer } from "./useDraggable";

const pointer = (type: string, clientX = 0) => Object.assign(new Event(type), { clientX, clientY: 0 });

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

  it("stops right away when asked (the window unmounts mid-drag)", () => {
    const handle = new EventTarget();
    const moved = vi.fn();
    const stop = followPointer(handle, moved);
    stop();
    handle.dispatchEvent(pointer("pointermove", 10));
    expect(moved).not.toHaveBeenCalled();
  });
});
