// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventDraft } from "../shared/api/types";
import { setLang } from "../shared/i18n";
import { QuickAdd, type QuickAddHandle } from "./QuickAdd";

// Wednesday, 4 November 2026, 18:00
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 4, 18, 0));
  setLang("en");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setLang("ru");
});

const CALENDARS = [
  { id: "me", name: "Personal" },
  { id: "work", name: "Work" },
];

const show = ({
  calendars = CALENDARS,
  variant,
  onCreate = vi.fn(async (_d: EventDraft) => {}),
}: {
  calendars?: { id: string; name: string }[];
  variant?: "main" | "widget" | "popup";
  onCreate?: (d: EventDraft) => Promise<void>;
} = {}) => {
  const onExpand = vi.fn();
  const ref = createRef<QuickAddHandle>();
  render(<QuickAdd ref={ref} calendars={calendars} onCreate={onCreate} onExpand={onExpand} variant={variant} />);
  const input = screen.getByRole("textbox", { name: "Quick add an event" }) as HTMLInputElement;
  return { input, onCreate, onExpand, ref };
};

const type = (input: HTMLInputElement, text: string) => fireEvent.change(input, { target: { value: text } });
const preview = () => screen.queryByRole("button");

describe("quick add", () => {
  it("the main window shows an example, the widget and the popup a short hint", () => {
    show();
    expect(screen.getByPlaceholderText("e.g. tomorrow 7pm English class 50 min")).toBeTruthy();
    cleanup();
    show({ variant: "widget" });
    expect(screen.getByPlaceholderText("+ New event")).toBeTruthy();
    cleanup();
    show({ variant: "popup" });
    expect(screen.getByPlaceholderText("+ New event")).toBeTruthy();
  });

  it("an empty line shows no preview and Enter does nothing", () => {
    const { input, onCreate } = show();
    type(input, "   ");
    expect(preview()).toBeNull();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("the preview shows the title, the time, the calendar and the place", () => {
    const { input } = show();
    type(input, "standup tomorrow 9am #work @Office_Gdynia half an hour");
    const text = preview()?.textContent ?? "";
    expect(text).toContain("Standup");
    expect(text).toContain("Work");
    expect(text).toContain("Office Gdynia");
    expect(text).toContain("Enter or click to add · Ctrl+Enter for details");
  });

  it("without a calendar in the line the first one is named", () => {
    const { input } = show();
    type(input, "tomorrow 7pm gym");
    expect(preview()?.textContent).toContain("Personal");
  });

  it("no calendars: nothing to name and nothing to add to", async () => {
    const { input, onCreate } = show({ calendars: [] });
    type(input, "tomorrow 7pm gym");
    expect(preview()?.textContent).not.toContain("Personal");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("No calendar you can add events to")).toBeTruthy();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("Enter creates the event in the first calendar and clears the line", async () => {
    const { input, onCreate } = show();
    type(input, "tomorrow 7pm English class 50 min");
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(input.value).toBe(""));
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ calendarId: "me", title: "English class", startDate: "2026-11-05", startTime: "19:00", endTime: "19:50" }),
    );
  });

  it("a click on the preview creates the event too", async () => {
    const { input, onCreate } = show();
    type(input, "tomorrow 7pm gym");
    fireEvent.click(preview() as HTMLElement);
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
  });

  it("the preview doesn't take the focus from the line", () => {
    const { input } = show();
    type(input, "tomorrow 7pm gym");
    expect(fireEvent.mouseDown(preview() as HTMLElement)).toBe(false);
  });

  it("Ctrl+Enter and Ctrl+click open the full form, even without a title", () => {
    const { input, onExpand, onCreate } = show();
    type(input, "tomorrow 7pm");
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(onExpand).toHaveBeenCalledWith(expect.objectContaining({ title: "", startTime: "19:00" }));
    expect(input.value).toBe("");
    type(input, "tomorrow 8pm gym");
    fireEvent.click(preview() as HTMLElement, { metaKey: true });
    expect(onExpand).toHaveBeenCalledTimes(2);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("a line without a title asks for one; typing takes the message away", async () => {
    const { input, onCreate } = show();
    type(input, "tomorrow 7pm");
    expect(preview()?.textContent).toContain("no title");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("Add a title")).toBeTruthy();
    expect(onCreate).not.toHaveBeenCalled();
    type(input, "tomorrow 7pm gym");
    expect(screen.queryByText("Add a title")).toBeNull();
  });

  it("a time the clock doesn't have asks to check it", async () => {
    const { input, onCreate } = show();
    type(input, "tomorrow 9:75 meeting");
    expect(preview()?.textContent).toContain("Check the date and time");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("Check the date and time")).toBeTruthy();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("a failed save keeps the line and shows why; an error without a message says it generally", async () => {
    const onCreate = vi.fn(async (_d: EventDraft) => {
      throw { message: "Google said no" };
    });
    const { input } = show({ onCreate });
    type(input, "tomorrow 7pm gym");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("Google said no")).toBeTruthy();
    expect(input.value).toBe("tomorrow 7pm gym");
    expect(input.disabled).toBe(false);
    onCreate.mockImplementationOnce(async () => {
      throw "offline";
    });
    type(input, "tomorrow 7pm gym");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("Couldn't create the event")).toBeTruthy();
  });

  it("while it is being saved the line is locked and a second Enter sends nothing", async () => {
    let done = () => {};
    const onCreate = vi.fn(() => new Promise<void>((r) => (done = r)));
    const { input } = show({ onCreate });
    type(input, "tomorrow 7pm gym");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.disabled).toBe(true);
    expect((preview() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCreate).toHaveBeenCalledTimes(1);
    await act(async () => done());
    expect(input.disabled).toBe(false);
  });

  it("Esc clears the line, the message and leaves the field; other keys don't", async () => {
    const { input, ref } = show();
    act(() => ref.current?.focus());
    expect(document.activeElement).toBe(input);
    type(input, "tomorrow 7pm");
    fireEvent.keyDown(input, { key: "a" });
    expect(input.value).toBe("tomorrow 7pm");
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText("Add a title");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("");
    expect(screen.queryByText("Add a title")).toBeNull();
    expect(document.activeElement).not.toBe(input);
  });
});

describe("quick add details", () => {
  it("the widget and the popup look of the line, no spell check", () => {
    const { input } = show({ variant: "widget" });
    expect(input.parentElement?.className).toContain("widget");
    expect(input.parentElement?.className).not.toContain("popup");
    expect(input.getAttribute("spellcheck")).toBe("false");
    cleanup();
    const popup = show({ variant: "popup" });
    expect(popup.input.parentElement?.className).toContain("popup");
    expect(popup.input.parentElement?.className).not.toContain("widget");
    cleanup();
    const main = show();
    expect(main.input.parentElement?.className).not.toMatch(/widget|popup/);
  });

  it("only Enter adds; Enter is kept from the page, other keys are not", async () => {
    const { input, onCreate } = show();
    type(input, "tomorrow 7pm gym");
    expect(fireEvent.keyDown(input, { key: "a" })).toBe(true);
    expect(onCreate).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
  });

  it("a wrong time replaces the preview with the message", async () => {
    const { input } = show();
    type(input, "tomorrow 9:75 meeting");
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText("Check the date and time");
    expect(preview()).toBeNull();
  });
});
