// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { Provider } from "effector-react";
import { allSettled, createWatch, type Scope } from "effector";
import { afterEach, describe, expect, it } from "vitest";
import { editorClosed, eventOpened } from "../model/editor";
import { eventKeyPressed } from "../model/keyboard";
import { appScope, event, renderIn } from "../ui/app-scope.test-utils";
import { eventElement, useEventKeys } from "./useEventKeys";

const Keys = ({ signedIn }: { signedIn: boolean }) => {
  useEventKeys(signedIn);
  return null;
};

type Block = { key: string; x: number; y: number; width?: number; height?: number };

const place = (el: HTMLElement, { x, y, width = 100, height = 40 }: Omit<Block, "key">) => {
  el.getBoundingClientRect = () =>
    ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height, toJSON: () => ({}) }) as DOMRect;
};

const button = (block: Block) => {
  const el = document.createElement("button");
  el.dataset.eventKey = block.key;
  el.textContent = block.key;
  place(el, block);
  return el;
};

/** event blocks inside <main>, as the views render them */
const page = (blocks: Block[]) => {
  const main = document.createElement("main");
  main.append(...blocks.map(button));
  document.body.append(main);
};

const block = (key: string) => document.querySelector<HTMLElement>(`main [data-event-key="${key}"]`)!;
const focused = () => (document.activeElement as HTMLElement | null)?.dataset.eventKey ?? null;

/** key down on the focused element; returns whether the default action was prevented */
const press = (init: KeyboardEventInit) => !fireEvent.keyDown(document.activeElement ?? document.body, init);

const setup = async ({ signedIn = true, blocks = [] as Block[] } = {}) => {
  page(blocks);
  const scope: Scope = await appScope({ events: blocks.map(({ key }) => event({ key })) });
  const pressed: unknown[] = [];
  createWatch({ unit: eventKeyPressed, scope, fn: (p) => pressed.push(p) });
  const { rerender } = renderIn(scope, <Keys signedIn={signedIn} />);
  const signIn = () =>
    rerender(
      <Provider value={scope}>
        <Keys signedIn />
      </Provider>,
    );
  return { scope, pressed, signIn };
};

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("the focused event block", () => {
  it("is the closest element with an event key, or none", () => {
    page([{ key: "a", x: 0, y: 0 }]);
    const inner = document.createElement("span");
    block("a").append(inner);
    expect(eventElement(inner)).toBe(block("a"));
    expect(eventElement(document.body)).toBeNull();
    expect(eventElement(window)).toBeNull();
    expect(eventElement(null)).toBeNull();
  });
});

describe("arrows with no event selected", () => {
  const blocks = [
    { key: "hidden", x: 0, y: 0, width: 0 },
    { key: "a", x: 0, y: 0 },
    { key: "b", x: 0, y: 100 },
    { key: "flat", x: 0, y: 200, height: 0 },
  ];

  it("down selects the first visible event, up the last", async () => {
    await setup({ blocks });
    expect(press({ key: "ArrowDown" })).toBe(true);
    expect(focused()).toBe("a");
    (document.activeElement as HTMLElement).blur();
    expect(press({ key: "ArrowUp" })).toBe(true);
    expect(focused()).toBe("b");
  });

  it("leave the key alone with a modifier, another key or while typing", async () => {
    await setup({ blocks });
    for (const mod of ["ctrlKey", "metaKey", "altKey", "shiftKey"]) expect(press({ key: "ArrowDown", [mod]: true })).toBe(false);
    expect(press({ key: "ArrowLeft" })).toBe(false);
    expect(focused()).toBeNull();

    for (const tag of ["input", "textarea", "select"]) {
      const field = document.createElement(tag);
      document.body.append(field);
      field.focus();
      expect(press({ key: "ArrowDown" })).toBe(false);
      expect(focused()).toBeNull();
    }
    // custom elements only look like fields
    for (const tag of ["x-input", "input-x"]) {
      const custom = document.createElement(tag);
      custom.tabIndex = 0;
      document.body.append(custom);
      custom.focus();
      expect(press({ key: "ArrowDown" })).toBe(true);
      expect(focused()).toBe("a");
      block("a").blur();
    }
    const editable = document.createElement("div");
    Object.defineProperty(editable, "isContentEditable", { value: true });
    document.body.append(editable);
    expect(!fireEvent.keyDown(editable, { key: "ArrowDown" })).toBe(false);
    expect(focused()).toBeNull();
  });

  it("do nothing when no event is on screen or outside the view", async () => {
    await setup();
    const outside = button({ key: "aside", x: 0, y: 0 });
    document.body.append(outside);
    expect(press({ key: "ArrowDown" })).toBe(false);
    expect(press({ key: "ArrowUp" })).toBe(false);
    expect(focused()).toBeNull();
  });

  it("are not handled while signed out", async () => {
    await setup({ signedIn: false, blocks });
    expect(press({ key: "ArrowDown" })).toBe(false);
    expect(focused()).toBeNull();
  });

  it("are handled once signed in", async () => {
    const { signIn } = await setup({ signedIn: false, blocks });
    signIn();
    expect(press({ key: "ArrowDown" })).toBe(true);
    expect(focused()).toBe("a");
  });

  it("stop being handled after unmounting", async () => {
    await setup({ blocks });
    cleanup();
    expect(press({ key: "ArrowDown" })).toBe(false);
    expect(focused()).toBeNull();
  });

  it("belong to an open dialog", async () => {
    await setup({ blocks });
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    expect(press({ key: "ArrowDown" })).toBe(false);
    expect(focused()).toBeNull();
  });
});

describe("arrows on a selected event", () => {
  // a  c
  // b
  const blocks = [
    { key: "a", x: 0, y: 0 },
    { key: "b", x: 0, y: 100 },
    { key: "c", x: 200, y: 0 },
    { key: "gone", x: 200, y: 100, height: 0 },
  ];

  it("move to the nearest event on screen that way", async () => {
    await setup({ blocks });
    block("a").focus();
    expect(press({ key: "ArrowDown" })).toBe(true);
    expect(focused()).toBe("b");
    press({ key: "ArrowRight" });
    expect(focused()).toBe("c");
    press({ key: "ArrowLeft" });
    expect(focused()).toBe("a");
  });

  it("stay put at the edge, still taking the key", async () => {
    await setup({ blocks });
    block("a").focus();
    expect(press({ key: "ArrowUp" })).toBe(true);
    expect(focused()).toBe("a");
  });

  it("start from a focused event outside the view by its own place", async () => {
    await setup({ blocks });
    const outside = button({ key: "aside", x: 0, y: -100 });
    document.body.append(outside);
    outside.focus();
    expect(press({ key: "ArrowDown" })).toBe(true);
    expect(focused()).toBe("a");
  });

  it("with a modifier are left to the view", async () => {
    await setup({ blocks });
    block("a").focus();
    expect(press({ key: "ArrowDown", shiftKey: true })).toBe(false);
    expect(focused()).toBe("a");
  });
});

describe("action keys on a selected event", () => {
  it.each([
    [{ code: "KeyE", key: "e" }, "edit"],
    [{ code: "KeyE", key: "у" }, "edit"],
    [{ code: "KeyD", key: "d", ctrlKey: true }, "duplicate"],
    [{ code: "KeyD", key: "d", metaKey: true }, "duplicate"],
    [{ key: "Delete" }, "delete"],
  ] as const)("%o is %s", async (init, action) => {
    const { pressed } = await setup({ blocks: [{ key: "a", x: 0, y: 0 }] });
    const inner = document.createElement("span");
    block("a").append(inner);
    expect(!fireEvent.keyDown(inner, init)).toBe(true);
    expect(pressed).toEqual([{ key: "a", action }]);
  });

  it.each([
    { code: "KeyE", key: "e", ctrlKey: true },
    { code: "KeyD", key: "d" },
    { code: "KeyD", key: "d", ctrlKey: true, shiftKey: true },
    { code: "KeyD", key: "d", ctrlKey: true, altKey: true },
    { key: "Delete", shiftKey: true },
    { key: "x" },
  ])("%o does nothing", async (init) => {
    const { pressed } = await setup({ blocks: [{ key: "a", x: 0, y: 0 }] });
    block("a").focus();
    expect(press(init)).toBe(false);
    expect(pressed).toEqual([]);
  });

  it("are ignored on an element without its event key", async () => {
    const { pressed } = await setup();
    const empty = document.createElement("button");
    empty.dataset.eventKey = "";
    document.body.append(empty);
    empty.focus();
    expect(press({ key: "Delete" })).toBe(false);
    expect(pressed).toEqual([]);
  });
});

describe("focus after the card closes", () => {
  const blocks = [
    { key: "a", x: 0, y: 0 },
    { key: "b", x: 0, y: 100 },
  ];
  const frame = () => act(() => new Promise<void>((done) => requestAnimationFrame(() => done())));

  it("returns to the event the card was opened from with a key", async () => {
    const { scope } = await setup({ blocks });
    block("b").focus();
    await act(async () => void press({ code: "KeyE", key: "e" }));
    block("a").focus();
    await act(() => allSettled(editorClosed, { scope }));
    await waitFor(() => expect(focused()).toBe("b"));
  });

  it("waits for the copy form to close too", async () => {
    const { scope } = await setup({ blocks: [...blocks, { key: "c", x: 0, y: 200 }] });
    block("c").focus();
    await act(async () => void press({ code: "KeyD", key: "d", ctrlKey: true }));
    block("b").focus();
    await frame();
    expect(focused()).toBe("b");
    await act(() => allSettled(editorClosed, { scope }));
    await waitFor(() => expect(focused()).toBe("c"));
  });

  it("returns after Enter or Space opened the card", async () => {
    for (const key of ["Enter", " "]) {
      const { scope } = await setup({ blocks });
      block("a").focus();
      expect(press({ key })).toBe(false);
      await act(() => allSettled(eventOpened, { scope, params: event({ key: "a" }) }));
      block("b").focus();
      await act(() => allSettled(editorClosed, { scope }));
      await waitFor(() => expect(focused()).toBe("a"));
      cleanup();
      document.body.innerHTML = "";
    }
  });

  it("stays where it is while the card is open, and once it has returned", async () => {
    const { scope } = await setup({ blocks });
    block("a").focus();
    await act(async () => void press({ code: "KeyE", key: "e" }));
    block("b").focus();
    await frame();
    expect(focused()).toBe("b");
    await act(() => allSettled(editorClosed, { scope }));
    await waitFor(() => expect(focused()).toBe("a"));

    await act(() => allSettled(eventOpened, { scope, params: event({ key: "a" }) }));
    block("b").focus();
    await act(() => allSettled(editorClosed, { scope }));
    await frame();
    expect(focused()).toBe("b");
  });

  it("is not moved when the card was opened with a mouse or Enter with a modifier", async () => {
    const { scope } = await setup({ blocks });
    block("a").focus();
    press({ key: "Enter", ctrlKey: true });
    await act(() => allSettled(eventOpened, { scope, params: event({ key: "a" }) }));
    block("b").focus();
    await act(() => allSettled(editorClosed, { scope }));
    await frame();
    expect(focused()).toBe("b");
  });

  it("is not moved when the event left the screen", async () => {
    const { scope } = await setup({ blocks });
    block("a").focus();
    await act(async () => void press({ code: "KeyE", key: "e" }));
    block("a").remove();
    block("b").focus();
    await act(() => allSettled(editorClosed, { scope }));
    await frame();
    expect(focused()).toBe("b");
  });
});
