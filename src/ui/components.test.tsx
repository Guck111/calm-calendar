// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../shared/i18n";
import { localTimeZone } from "../shared/lib/date";
import { shortcutsRequested } from "../model/shortcuts";
import { ErrorBoundary } from "./ErrorBoundary";
import { FeedbackForm } from "./FeedbackForm";
import { Shortcuts } from "./Shortcuts";
import { TimeZoneSelect } from "./TimeZoneSelect";

const mocks = vi.hoisted(() => ({
  logError: vi.fn(),
  openExternal: vi.fn(async (_href: string) => {}),
  copyText: vi.fn(async (_text: string) => true),
  isStoreBuild: vi.fn(async () => false),
  readSettings: vi.fn(async () => ({ quick_hotkey: "ctrl+alt+space" as string | null })),
}));
vi.mock("../shared/lib/log", async (real) => ({ ...(await real<object>()), logError: mocks.logError }));
vi.mock("../shared/api/open", () => ({ openExternal: mocks.openExternal }));
vi.mock("../shared/lib/clipboard", () => ({ copyText: mocks.copyText }));
vi.mock("../shared/api/store", () => ({ isStoreBuild: mocks.isStoreBuild }));
vi.mock("../shared/lib/glass", async (real) => ({ ...(await real<object>()), readSettings: mocks.readSettings }));

beforeEach(() => setLang("en"));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setLang("ru");
});

describe("error screen", () => {
  const Broken = (): never => {
    throw new Error("boom");
  };

  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

  it("shows the window as usual while nothing breaks", () => {
    render(
      <ErrorBoundary>
        <p>calendar</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("calendar")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a crash shows an explanation and a restart button instead of a white screen, and goes to the log", () => {
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Something went wrong");
    expect(screen.getByRole("button", { name: "Restart window" })).toBeTruthy();
    expect(mocks.logError).toHaveBeenCalledWith(expect.stringMatching(/^render failed/), expect.objectContaining({ message: "boom" }));
  });

  it("the log names the broken component with the first lines of the component stack", () => {
    const Deep = ({ level }: { level: number }) => (level ? <Deep level={level - 1} /> : <Broken />);
    render(
      <ErrorBoundary>
        <Deep level={10} />
      </ErrorBoundary>,
    );
    const [message] = mocks.logError.mock.calls[0];
    const lines = message.split("\n");
    expect(lines[0]).toBe("render failed in");
    expect(lines[1]).toContain("Broken");
    expect(lines.length).toBe(6);
  });

  it("a small window gets the short version", () => {
    const full = render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );
    const fullParagraphs = full.container.querySelectorAll("p").length;
    full.unmount();
    const compact = render(
      <ErrorBoundary compact>
        <Broken />
      </ErrorBoundary>,
    );
    expect(fullParagraphs).toBe(1);
    expect(compact.container.querySelectorAll("p").length).toBe(0);
  });
});

describe("time zone list", () => {
  const options = () => [...(screen.getByRole("combobox") as HTMLSelectElement).options].map((o) => o.value);

  it("starts with the system time zone and lists each zone once", () => {
    render(<TimeZoneSelect value="Asia/Tokyo" onChange={vi.fn()} />);
    const list = options();
    expect(list[0]).toBe(localTimeZone());
    expect(new Set(list).size).toBe(list.length);
    expect(list).toContain("Asia/Tokyo");
  });

  it("keeps a zone name missing from the system list (an old alias) right after the system one", () => {
    render(<TimeZoneSelect value="Europe/Kyiv" onChange={vi.fn()} />);
    expect(options()[1]).toBe("Europe/Kyiv");
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("Europe/Kyiv");
  });

  it("lists the other zones after the system one", () => {
    render(<TimeZoneSelect value={localTimeZone()} onChange={vi.fn()} />);
    const list = options();
    expect(list.length).toBeGreaterThan(100);
    expect(list.filter((z) => z === localTimeZone())).toHaveLength(1);
  });

  it("a new value missing from the list is added on the next render", () => {
    const { rerender } = render(<TimeZoneSelect value="Asia/Tokyo" onChange={vi.fn()} />);
    rerender(<TimeZoneSelect value="Europe/Kyiv" onChange={vi.fn()} />);
    expect(options()[1]).toBe("Europe/Kyiv");
  });

  it("reports the picked zone", () => {
    const onChange = vi.fn();
    render(<TimeZoneSelect value="Asia/Tokyo" onChange={onChange} aria-label="Time zone" />);
    fireEvent.change(screen.getByRole("combobox", { name: "Time zone" }), { target: { value: "Europe/Warsaw" } });
    expect(onChange).toHaveBeenCalledWith("Europe/Warsaw");
  });
});

describe("feedback form", () => {
  const type = (text: string) => fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });

  it("can't be sent empty", () => {
    render(<FeedbackForm />);
    expect((screen.getByRole("button", { name: "Open in mail" }) as HTMLButtonElement).disabled).toBe(true);
    type("   ");
    expect((screen.getByRole("button", { name: "Copy the text" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("opens a letter of the chosen kind in the mail app", async () => {
    render(<FeedbackForm />);
    fireEvent.click(screen.getByRole("radio", { name: "Problem" }));
    expect(screen.getByRole("radio", { name: "Problem" }).getAttribute("aria-checked")).toBe("true");
    type("The widget is blank");
    fireEvent.click(screen.getByRole("button", { name: "Open in mail" }));
    await waitFor(() => expect(mocks.openExternal).toHaveBeenCalledOnce());
    const href = decodeURIComponent(mocks.openExternal.mock.calls[0][0]);
    expect(href).toMatch(/^mailto:/);
    expect(href).toContain("Problem");
    expect(href).toContain("The widget is blank");
    expect(mocks.copyText).not.toHaveBeenCalled();
  });

  it("a suggestion is the default kind, and only the chosen kind is checked", async () => {
    render(<FeedbackForm />);
    const checked = () => screen.getAllByRole("radio").filter((r) => r.getAttribute("aria-checked") === "true").map((r) => r.textContent);
    expect(checked()).toEqual(["Suggestion"]);
    fireEvent.click(screen.getByRole("radio", { name: "Question" }));
    expect(checked()).toEqual(["Question"]);
    type("Hi");
    fireEvent.click(screen.getByRole("button", { name: "Open in mail" }));
    await waitFor(() => expect(mocks.openExternal).toHaveBeenCalledOnce());
    expect(decodeURIComponent(mocks.openExternal.mock.calls[0][0])).toContain(": Question");
  });

  it("the letter says which build it came from", async () => {
    render(<FeedbackForm />);
    type("Hi");
    fireEvent.click(screen.getByRole("button", { name: "Open in mail" }));
    await waitFor(() => expect(mocks.openExternal).toHaveBeenCalledOnce());
    expect(decodeURIComponent(mocks.openExternal.mock.calls[0][0])).toMatch(/Calm Calendar \S+ \(browser\)/);
    cleanup();
    mocks.openExternal.mockClear();
    mocks.isStoreBuild.mockResolvedValueOnce(true);
    render(<FeedbackForm />);
    await act(async () => {});
    type("Hi");
    fireEvent.click(screen.getByRole("button", { name: "Open in mail" }));
    await waitFor(() => expect(mocks.openExternal).toHaveBeenCalledOnce());
    expect(decodeURIComponent(mocks.openExternal.mock.calls[0][0])).toContain("(Microsoft Store)");
  });

  it("when the clipboard refuses, no note promises a copy", async () => {
    mocks.copyText.mockResolvedValue(false);
    render(<FeedbackForm />);
    type("x".repeat(5000));
    fireEvent.click(screen.getByRole("button", { name: "Open in mail" }));
    await waitFor(() => expect(mocks.openExternal).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Copy the text" }));
    await act(async () => {});
    expect(screen.queryByRole("status")).toBeNull();
    mocks.copyText.mockResolvedValue(true);
  });

  it("a text too long for a link waits on the clipboard", async () => {
    render(<FeedbackForm />);
    type("x".repeat(5000));
    fireEvent.click(screen.getByRole("button", { name: "Open in mail" }));
    await waitFor(() => expect(mocks.openExternal).toHaveBeenCalledOnce());
    expect(mocks.copyText).toHaveBeenCalledWith(expect.stringContaining("x".repeat(5000)));
    expect(screen.getByRole("status").textContent).toContain("copied");
    expect(decodeURIComponent(mocks.openExternal.mock.calls[0][0])).not.toContain("x".repeat(5000));
  });

  it("copy says where to send the text; typing again hides the note", async () => {
    render(<FeedbackForm />);
    type("Thanks");
    fireEvent.click(screen.getByRole("button", { name: "Copy the text" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/^Copied\. Send it to .+@/));
    type("Thanks!");
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("keyboard shortcuts window", () => {
  const press = (init: KeyboardEventInit, target: EventTarget = window) =>
    act(() => {
      target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
    });

  it("opens on '?' and closes on Escape", async () => {
    render(<Shortcuts />);
    expect(screen.queryByRole("dialog")).toBeNull();
    press({ key: "?", code: "Slash", shiftKey: true });
    expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeTruthy();
    press({ key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Shift+/ opens it on any layout, other keys don't", async () => {
    render(<Shortcuts />);
    press({ key: "/", code: "Slash" });
    press({ key: "a", code: "KeyA", shiftKey: true });
    press({ key: "?", code: "Digit7", altKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
    press({ key: ",", code: "Slash", shiftKey: true });
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("only Escape and the close button close it", async () => {
    render(<Shortcuts />);
    act(() => shortcutsRequested());
    await screen.findByRole("dialog");
    press({ key: "a" });
    expect(screen.queryByRole("dialog")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the quick add hotkey from the settings, and none when it is off", async () => {
    mocks.readSettings.mockResolvedValueOnce({ quick_hotkey: "alt+shift+space" });
    render(<Shortcuts />);
    act(() => shortcutsRequested());
    await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("AltShiftSpace"));
    cleanup();
    mocks.readSettings.mockResolvedValueOnce({ quick_hotkey: null });
    render(<Shortcuts />);
    act(() => shortcutsRequested());
    await act(async () => {});
    expect(screen.getByRole("dialog").textContent).not.toMatch(/CtrlAltSpace|AltShiftSpace/);
  });

  it("stops listening once the window is gone", () => {
    const requested = vi.fn();
    const unwatch = shortcutsRequested.watch(requested);
    const { unmount } = render(<Shortcuts />);
    unmount();
    press({ key: "?", code: "Slash", shiftKey: true });
    unwatch();
    expect(requested).not.toHaveBeenCalled();
  });

  it("'?' typed in a field or with Ctrl is not a shortcut", () => {
    render(
      <>
        <input aria-label="title" />
        <Shortcuts />
      </>,
    );
    press({ key: "?", shiftKey: true }, screen.getByRole("textbox", { name: "title" }));
    press({ key: "?", ctrlKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not open over another dialog, but the command menu can open it", async () => {
    render(
      <>
        <div role="dialog" aria-label="event card" />
        <Shortcuts />
      </>,
    );
    press({ key: "?" });
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull();
    act(() => shortcutsRequested());
    expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeTruthy();
  });

  it("a click on the backdrop closes it, a click inside does not", async () => {
    render(<Shortcuts />);
    act(() => shortcutsRequested());
    const dialog = await screen.findByRole("dialog");
    fireEvent.mouseDown(dialog);
    expect(screen.queryByRole("dialog")).not.toBeNull();
    fireEvent.mouseDown(dialog.parentElement!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
