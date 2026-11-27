// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../shared/i18n";
import { UndoToast } from "./UndoToast";

// the bar's own model is tested in model/undo; here only what the bar sends and shows
const undo = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("../model/undo", async () => {
  const { createEvent, createStore } = await import("effector");
  const shown = createEvent<{ id: number; kind: "moved" | "deleted"; title: string } | null>();
  const track = (name: string) => {
    const event = createEvent();
    event.watch(() => undo.calls.push(name));
    return event;
  };
  return {
    shown,
    $undo: createStore<{ id: number; kind: "moved" | "deleted"; title: string } | null>(null).on(shown, (_, v) => v),
    undoClicked: track("undo"),
    undoDismissed: track("dismiss"),
    undoPaused: track("pause"),
    undoResumed: track("resume"),
  };
});
const { shown } = (await import("../model/undo")) as unknown as {
  shown: (v: { id: number; kind: "moved" | "deleted"; title: string } | null) => void;
};

beforeEach(() => {
  setLang("en");
  undo.calls = [];
});
afterEach(() => {
  act(() => shown(null));
  cleanup();
  setLang("ru");
});

const show = (kind: "moved" | "deleted" = "deleted", title = "Dentist") => {
  render(<UndoToast />);
  act(() => shown({ id: 1, kind, title }));
  return screen.getByText(/Dentist|Call/).parentElement as HTMLElement;
};

const ctrlZ = (over: KeyboardEventInit = {}, target: Window | Element = window) =>
  fireEvent.keyDown(target, { code: "KeyZ", key: "z", ctrlKey: true, ...over });

describe("undo bar", () => {
  it("nothing to undo: an empty region, Ctrl+Z does nothing", () => {
    const { container } = render(<UndoToast />);
    expect(container.firstElementChild?.getAttribute("aria-live")).toBe("polite");
    expect(container.firstElementChild?.childElementCount).toBe(0);
    ctrlZ();
    expect(undo.calls).toEqual([]);
  });

  it("names what was deleted or moved", () => {
    show("deleted");
    expect(screen.getByText("Deleted: Dentist")).toBeTruthy();
    act(() => shown({ id: 2, kind: "moved", title: "Call" }));
    expect(screen.getByText("Moved: Call")).toBeTruthy();
  });

  it("Undo and the cross", () => {
    show();
    expect(screen.getByRole("button", { name: "Undo" }).title).toBe("Ctrl+Z");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(undo.calls).toEqual(["undo", "dismiss"]);
  });

  it("Ctrl+Z and Cmd+Z undo; with Shift, without Ctrl or another key they don't", () => {
    show();
    ctrlZ({ shiftKey: true });
    ctrlZ({ ctrlKey: false });
    ctrlZ({ code: "KeyY" });
    expect(undo.calls).toEqual([]);
    expect(ctrlZ()).toBe(false);
    ctrlZ({ ctrlKey: false, metaKey: true });
    expect(undo.calls).toEqual(["undo", "undo"]);
  });

  it("Ctrl+Z while typing undoes the typing, not the deletion", () => {
    show();
    const field = document.createElement("input");
    const area = document.createElement("textarea");
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    Object.defineProperty(editable, "isContentEditable", { value: true });
    document.body.append(field, area, editable);
    for (const target of [field, area, editable]) ctrlZ({}, target);
    expect(undo.calls).toEqual([]);
    const plain = document.createElement("div");
    document.body.append(plain);
    ctrlZ({}, plain);
    expect(undo.calls).toEqual(["undo"]);
    for (const el of [field, area, editable, plain]) el.remove();
  });

  it("closing the window sends the deletion at once", () => {
    show();
    fireEvent(window, new Event("pagehide"));
    expect(undo.calls).toEqual(["dismiss"]);
  });

  it("after the bar is gone the keys and leaving the window do nothing", () => {
    show();
    act(() => shown(null));
    ctrlZ();
    fireEvent(window, new Event("pagehide"));
    expect(undo.calls).toEqual([]);
  });

  it("mouse and focus hold the bar; it goes on only when both have left", () => {
    const bar = show();
    fireEvent.mouseEnter(bar);
    fireEvent.focus(screen.getByRole("button", { name: "Undo" }));
    expect(undo.calls).toEqual(["pause"]);
    fireEvent.mouseLeave(bar);
    expect(undo.calls).toEqual(["pause"]);
    // focus moves inside the bar: still held
    fireEvent.blur(screen.getByRole("button", { name: "Undo" }), { relatedTarget: screen.getByRole("button", { name: "Close" }) });
    expect(undo.calls).toEqual(["pause"]);
    fireEvent.blur(screen.getByRole("button", { name: "Close" }), { relatedTarget: document.body });
    expect(undo.calls).toEqual(["pause", "resume"]);
  });

  it("a new bar starts unheld", () => {
    const bar = show();
    fireEvent.mouseEnter(bar);
    act(() => shown({ id: 2, kind: "moved", title: "Call" }));
    const next = screen.getByText("Moved: Call").parentElement as HTMLElement;
    fireEvent.mouseEnter(next);
    expect(undo.calls).toEqual(["pause", "pause"]);
  });
});
