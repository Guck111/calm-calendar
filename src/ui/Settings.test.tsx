// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { fork, type Scope } from "effector";
import { Provider } from "effector-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { $feeds, $holidayRegion, $weekNumbers } from "../model/display";
import { $secondZoneSetting } from "../model/zones";
import { readLangSetting, setLang } from "../shared/i18n";
import { APP_VERSION, WHATS_NEW_URL } from "../shared/lib/version";
import { SettingsDialog } from "./Settings";

const mocks = vi.hoisted(() => ({
  tauri: true,
  glassSupported: true,
  broadcast: vi.fn(),
  openExternal: vi.fn(async (_href: string) => {}),
  openLogsFolder: vi.fn(async () => {}),
  downloadFeed: vi.fn(async (_url: string): Promise<{ name?: string }> => ({ name: "Matches" })),
  dropFeedCache: vi.fn(),
  readDesktop: vi.fn(async () => ({ widget: false, on_top: false, autostart: false })),
  readSettings: vi.fn(async () => ({
    notifications: false,
    private_notifications: false,
    alerts: "off" as string,
    quick_hotkey: "ctrl+alt+space" as string | null,
  })),
  initGlass: vi.fn((_on: (g: boolean) => void) => () => {}),
  setGlass: vi.fn(async (_on: boolean) => {}),
  setWidget: vi.fn(async (_v: object) => {}),
  setAutostart: vi.fn(async (on: boolean) => on),
  setNotifications: vi.fn(async (_on: boolean) => {}),
  setPrivateNotifications: vi.fn(async (_on: boolean) => {}),
  setAlerts: vi.fn(async (_mode: string) => {}),
  setQuickHotkey: vi.fn(async (_h: string | null) => {}),
}));

vi.mock("../shared/api/bus", async (real) => ({
  ...(await real<object>()),
  get inTauri() {
    return mocks.tauri;
  },
  broadcast: mocks.broadcast,
}));
vi.mock("../shared/api/open", () => ({ openExternal: mocks.openExternal }));
vi.mock("../shared/api/store", () => ({ isStoreBuild: async () => false }));
vi.mock("../shared/api/feeds", () => ({ downloadFeed: mocks.downloadFeed, dropFeedCache: mocks.dropFeedCache }));
vi.mock("../shared/lib/log", async (real) => ({ ...(await real<object>()), openLogsFolder: mocks.openLogsFolder }));
vi.mock("../shared/lib/glass", () => ({
  get glassSupported() {
    return mocks.glassSupported;
  },
  initGlass: mocks.initGlass,
  readDesktop: mocks.readDesktop,
  readSettings: mocks.readSettings,
  setAutostart: mocks.setAutostart,
  setWidget: mocks.setWidget,
  setGlass: mocks.setGlass,
  setNotifications: mocks.setNotifications,
  setAlerts: mocks.setAlerts,
  setPrivateNotifications: mocks.setPrivateNotifications,
  setQuickHotkey: mocks.setQuickHotkey,
}));

beforeEach(() => {
  setLang("en");
  localStorage.clear();
  mocks.tauri = true;
  mocks.glassSupported = true;
});
afterEach(() => {
  cleanup();
  // also drops one-off answers a test queued but did not use
  vi.resetAllMocks();
  setLang("ru");
});

type Settings = Awaited<ReturnType<typeof mocks.readSettings>>;
type Desktop = Awaited<ReturnType<typeof mocks.readDesktop>>;

const failing = () => Promise.reject(new Error("no"));

const show = async (props: { onHeadDrag?: () => void } = {}, values: [unknown, unknown][] = []) => {
  const onClose = vi.fn();
  const onReschedule = vi.fn();
  const scope: Scope = fork({
    values: [[$feeds, []], [$weekNumbers, false], [$holidayRegion, null], [$secondZoneSetting, { enabled: false, zone: "UTC" }], ...values] as never,
  });
  render(
    <Provider value={scope}>
      <SettingsDialog onClose={onClose} onReschedule={onReschedule} {...props} />
    </Provider>,
  );
  // the settings read from Rust have arrived
  await act(async () => {});
  return { scope, onClose, onReschedule };
};

const tab = (name: string) => screen.getByRole("tab", { name });
const open = (name: string) => fireEvent.click(tab(name));
const toggle = (label: string) => screen.getByRole("switch", { name: new RegExp(`^${label}`) }) as HTMLInputElement;
const select = (name: string) => screen.getByRole("combobox", { name }) as HTMLSelectElement;
const error = (text: string) => waitFor(() => expect(screen.getByText(text)).toBeTruthy());

describe("settings window", () => {
  it("opens on Appearance; a click on a section opens it and hides the rest", async () => {
    await show();
    expect(screen.getByRole("dialog", { name: "Settings" }).getAttribute("aria-modal")).toBe("true");
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["Appearance", "Calendar", "Reminders", "Quick access", "Help"]);
    expect(tab("Appearance").getAttribute("aria-selected")).toBe("true");
    expect(tab("Appearance").tabIndex).toBe(0);
    expect(tab("Help").tabIndex).toBe(-1);
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe("settings-tab-look");
    open("Reminders");
    expect(tab("Reminders").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").id).toBe("settings-panel-reminders");
    expect(within(screen.getByRole("tabpanel")).getByRole("heading", { level: 3 }).textContent).toBe("Reminders");
  });

  it("arrows move along the sections and wrap around, focus follows; other keys do nothing", async () => {
    await show();
    const list = screen.getByRole("tablist");
    fireEvent.keyDown(list, { key: "ArrowUp" });
    expect(tab("Help").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("Help"));
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(tab("Appearance").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(tab("Calendar").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(tab("Calendar").getAttribute("aria-selected")).toBe("true");
  });

  it("the version and What's new", async () => {
    await show();
    expect(screen.getByText(`Version ${APP_VERSION}`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "What's new" }));
    expect(mocks.openExternal).toHaveBeenCalledWith(WHATS_NEW_URL);
  });

  it("closes by the cross, Esc and a click beside it; not by other keys or a click inside", async () => {
    const { onClose } = await show();
    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("in its own window: not modal, the header drags the window, a click beside it doesn't close", async () => {
    const onHeadDrag = vi.fn();
    const { onClose } = await show({ onHeadDrag });
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("false");
    fireEvent.pointerDown(screen.getByRole("heading", { level: 2 }).parentElement as HTMLElement);
    expect(onHeadDrag).toHaveBeenCalled();
    fireEvent.mouseDown(dialog.parentElement as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("an error goes away when another section opens", async () => {
    mocks.setGlass.mockImplementationOnce(failing);
    await show();
    fireEvent.click(toggle("Glass effect"));
    await error("Couldn't change the glass effect");
    open("Calendar");
    expect(screen.queryByText("Couldn't change the glass effect")).toBeNull();
  });
});

describe("Appearance", () => {
  it("a theme is picked and remembered", async () => {
    // the window theme itself is set through Tauri: not in a test
    mocks.tauri = false;
    await show();
    const themes = screen.getByRole("radiogroup", { name: "Theme" });
    expect(within(themes).getByRole("radio", { name: "System" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(themes).getByRole("radio", { name: "Dark" }));
    expect(within(themes).getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe("true");
    expect(within(themes).getByRole("radio", { name: "System" }).getAttribute("aria-checked")).toBe("false");
    expect(JSON.parse(localStorage.getItem("calm.theme") ?? "null")).toBe("dark");
  });

  it("a style brings its fonts; a font can be chosen apart from the style", async () => {
    await show();
    const styles = screen.getByRole("radiogroup", { name: "Style" });
    fireEvent.click(within(styles).getByRole("radio", { name: /Paper/ }));
    expect(within(styles).getByRole("radio", { name: /Paper/ }).getAttribute("aria-checked")).toBe("true");
    const display = screen.getByRole("combobox", { name: "Heading and number font" }) as HTMLSelectElement;
    const text = screen.getByRole("combobox", { name: "Text font" }) as HTMLSelectElement;
    expect(display.value).toBe("auto");
    expect(display.options[0].text).toBe("Style default (Cormorant Garamond)");
    expect(text.options[0].text).toBe("Style default (Inter)");
    // the text list has no wide or thin display fonts
    expect([...text.options].map((o) => o.value)).not.toContain("unbounded");
    expect([...display.options].map((o) => o.value)).toContain("unbounded");
    fireEvent.change(text, { target: { value: "manrope" } });
    fireEvent.change(display, { target: { value: "geist" } });
    expect(JSON.parse(localStorage.getItem("calm.appearance") ?? "{}")).toMatchObject({ style: "paper", text: "manrope", display: "geist" });
    expect(display.style.fontFamily).toContain("Geist");
  });

  it("glass: turned on and off, a failure turns the switch back", async () => {
    await show();
    expect(screen.getByText(/energy saver/)).toBeTruthy();
    fireEvent.click(toggle("Glass effect"));
    expect(mocks.setGlass).toHaveBeenLastCalledWith(true);
    expect(toggle("Glass effect").checked).toBe(true);
    mocks.setGlass.mockImplementationOnce(failing);
    fireEvent.click(toggle("Glass effect"));
    await error("Couldn't change the glass effect");
    expect(toggle("Glass effect").checked).toBe(true);
  });

  it("the glass state read from the system is shown", async () => {
    mocks.initGlass.mockImplementationOnce((on) => (on(true), () => {}));
    await show();
    expect(toggle("Glass effect").checked).toBe(true);
  });

  it("without Windows glass is off and says why", async () => {
    mocks.glassSupported = false;
    await show();
    expect(toggle("Glass effect").disabled).toBe(true);
    expect(screen.getByText(/Works on Windows only/)).toBeTruthy();
  });
});

describe("Calendar", () => {
  it("the second time zone: its list works only while it is on; other windows are told", async () => {
    const { scope } = await show();
    open("Calendar");
    const zone = select("Second time zone");
    expect(zone.disabled).toBe(true);
    fireEvent.click(toggle("Second time zone"));
    expect(zone.disabled).toBe(false);
    fireEvent.change(zone, { target: { value: "Asia/Tokyo" } });
    expect(scope.getState($secondZoneSetting)).toEqual({ enabled: true, zone: "Asia/Tokyo" });
    expect(mocks.broadcast).toHaveBeenCalledWith("display-changed");
    expect(mocks.broadcast).toHaveBeenCalledTimes(2);
  });

  it("week numbers and holidays", async () => {
    const { scope } = await show();
    open("Calendar");
    fireEvent.click(toggle("Week numbers"));
    expect(scope.getState($weekNumbers)).toBe(true);
    const holidays = select("Holidays");
    expect(holidays.value).toBe("");
    expect(holidays.options[0].text).toBe("Don't show");
    fireEvent.change(holidays, { target: { value: "PL" } });
    expect(scope.getState($holidayRegion)).toBe("PL");
    fireEvent.change(holidays, { target: { value: "" } });
    expect(scope.getState($holidayRegion)).toBeNull();
    expect(mocks.broadcast.mock.calls.filter(([name]) => name === "display-changed")).toHaveLength(3);
  });

  it("the language list starts with System and is remembered", async () => {
    mocks.tauri = false;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await show();
    open("Calendar");
    const language = select("Language");
    expect(language.value).toBe("system");
    expect(language.options[0].text).toBe("System");
    fireEvent.change(language, { target: { value: "de" } });
    expect(readLangSetting()).toBe("de");
  });
});

describe("calendar subscriptions", () => {
  const link = () => screen.getByRole("textbox", { name: "Calendar link (.ics)" }) as HTMLInputElement;
  const add = () => screen.getByRole("button", { name: "Add" }) as HTMLButtonElement;

  it("a link is downloaded, the calendar is added by its own name, the field is cleared", async () => {
    const { scope } = await show();
    open("Calendar");
    expect(add().disabled).toBe(true);
    fireEvent.change(link(), { target: { value: " https://example.com/sport.ics " } });
    expect(add().disabled).toBe(false);
    fireEvent.click(add());
    await waitFor(() => expect(screen.getByText("Matches")).toBeTruthy());
    expect(mocks.downloadFeed).toHaveBeenCalledWith("https://example.com/sport.ics");
    expect(scope.getState($feeds)[0]).toMatchObject({ url: "https://example.com/sport.ics", name: "Matches" });
    expect(link().value).toBe("");
    expect(link().disabled).toBe(false);
    expect(mocks.broadcast).toHaveBeenCalledWith("display-changed");
  });

  it("a calendar without a name is named after its site", async () => {
    mocks.downloadFeed.mockResolvedValueOnce({});
    const { scope } = await show();
    open("Calendar");
    fireEvent.change(link(), { target: { value: "https://example.com/a.ics" } });
    fireEvent.click(add());
    await waitFor(() => expect(scope.getState($feeds)).toHaveLength(1));
    expect(scope.getState($feeds)[0].name).toBe("example.com");
  });

  it("not a link, the same link again, a failed download and a page that is not .ics each say why", async () => {
    const feed = { id: "f1", url: "https://example.com/sport.ics", name: "Sport", color: "#f00" };
    await show({}, [[$feeds, [feed]]]);
    open("Calendar");
    // a link the field takes but that is no calendar address
    fireEvent.change(link(), { target: { value: "https://sport" } });
    fireEvent.click(add());
    await error("Couldn't download a calendar from this link.");
    expect(mocks.downloadFeed).not.toHaveBeenCalled();

    fireEvent.change(link(), { target: { value: "https://EXAMPLE.com/sport.ics/" } });
    expect(screen.queryByText("Couldn't download a calendar from this link.")).toBeNull();
    fireEvent.click(add());
    await error("This calendar is already added.");

    mocks.downloadFeed.mockRejectedValueOnce(new Error("This link doesn't lead to an .ics calendar."));
    fireEvent.change(link(), { target: { value: "https://example.com/page" } });
    fireEvent.click(add());
    await error("This link doesn't lead to an .ics calendar.");

    mocks.downloadFeed.mockRejectedValueOnce(null);
    fireEvent.click(add());
    await error("Couldn't download a calendar from this link.");
    expect(link().value).toBe("https://example.com/page");
  });

  it("a blank field adds nothing", async () => {
    await show();
    open("Calendar");
    fireEvent.change(link(), { target: { value: "   " } });
    fireEvent.submit(link().form as HTMLFormElement);
    expect(mocks.downloadFeed).not.toHaveBeenCalled();
  });

  it("a subscription is removed with its cache", async () => {
    const feed = { id: "f1", url: "https://example.com/sport.ics", name: "Sport", color: "#f00" };
    const { scope } = await show({}, [[$feeds, [feed]]]);
    open("Calendar");
    expect(screen.getByText("Sport").getAttribute("title")).toBe(feed.url);
    fireEvent.click(screen.getByRole("button", { name: "Remove Sport" }));
    expect(scope.getState($feeds)).toEqual([]);
    expect(mocks.dropFeedCache).toHaveBeenCalledWith("f1");
    expect(mocks.broadcast).toHaveBeenCalledWith("display-changed");
  });
});

describe("Reminders", () => {
  it("shows what is saved; notifications on reschedule the reminders, off does not", async () => {
    mocks.readSettings.mockResolvedValueOnce({ notifications: true, private_notifications: true, alerts: "calls", quick_hotkey: null });
    const { onReschedule } = await show();
    open("Reminders");
    expect(toggle("Event notifications").checked).toBe(true);
    expect(toggle("Hide titles").checked).toBe(true);
    expect(select("Hard-to-miss alert").value).toBe("calls");
    fireEvent.click(toggle("Event notifications"));
    expect(mocks.setNotifications).toHaveBeenLastCalledWith(false);
    await act(async () => {});
    expect(onReschedule).not.toHaveBeenCalled();
    expect(toggle("Hide titles").disabled).toBe(true);
    fireEvent.click(toggle("Event notifications"));
    await waitFor(() => expect(onReschedule).toHaveBeenCalledTimes(1));
  });

  it("a failed notifications change turns the switch back", async () => {
    mocks.setNotifications.mockImplementationOnce(failing);
    const { onReschedule } = await show();
    open("Reminders");
    fireEvent.click(toggle("Event notifications"));
    await error("Couldn't change notifications");
    expect(toggle("Event notifications").checked).toBe(false);
    expect(onReschedule).not.toHaveBeenCalled();
  });

  it("hidden titles: saved, a failure turns the switch back", async () => {
    mocks.readSettings.mockResolvedValueOnce({ notifications: true, private_notifications: false, alerts: "off", quick_hotkey: null });
    await show();
    open("Reminders");
    fireEvent.click(toggle("Hide titles"));
    expect(mocks.setPrivateNotifications).toHaveBeenLastCalledWith(true);
    mocks.setPrivateNotifications.mockImplementationOnce(failing);
    fireEvent.click(toggle("Hide titles"));
    await error("Couldn't save the setting");
    expect(toggle("Hide titles").checked).toBe(true);
  });

  it("the alert: a mode reschedules, off does not; a failure brings the old mode back", async () => {
    const { onReschedule } = await show();
    open("Reminders");
    const alert = select("Hard-to-miss alert");
    expect([...alert.options].map((o) => o.text)).toEqual(["Off", "Video calls only", "All timed events"]);
    fireEvent.change(alert, { target: { value: "all" } });
    await waitFor(() => expect(onReschedule).toHaveBeenCalledTimes(1));
    expect(mocks.setAlerts).toHaveBeenLastCalledWith("all");
    fireEvent.change(alert, { target: { value: "off" } });
    await act(async () => {});
    expect(onReschedule).toHaveBeenCalledTimes(1);
    mocks.setAlerts.mockImplementationOnce(failing);
    fireEvent.change(alert, { target: { value: "calls" } });
    await error("Couldn't save the setting");
    expect(alert.value).toBe("off");
  });

  it("in a browser the switches are off: there is no app behind them", async () => {
    mocks.tauri = false;
    await show();
    open("Reminders");
    expect(toggle("Event notifications").disabled).toBe(true);
    expect(toggle("Hide titles").disabled).toBe(true);
    expect(select("Hard-to-miss alert").disabled).toBe(true);
  });
});

describe("Quick access", () => {
  it("the shortcut: the saved one is shown, another is set, Off turns it off", async () => {
    await show();
    open("Quick access");
    const hotkey = select("Quick add from anywhere");
    expect(hotkey.value).toBe("ctrl+alt+space");
    expect([...hotkey.options].map((o) => o.text)).toEqual(["Off", "Ctrl+Alt+Space", "Ctrl+Shift+Space", "Alt+Shift+Space"]);
    fireEvent.change(hotkey, { target: { value: "alt+shift+space" } });
    expect(mocks.setQuickHotkey).toHaveBeenLastCalledWith("alt+shift+space");
    fireEvent.change(hotkey, { target: { value: "off" } });
    expect(mocks.setQuickHotkey).toHaveBeenLastCalledWith(null);
  });

  it("no saved shortcut shows Off", async () => {
    mocks.readSettings.mockResolvedValueOnce({ notifications: false, private_notifications: false, alerts: "off", quick_hotkey: null });
    await show();
    open("Quick access");
    expect(select("Quick add from anywhere").value).toBe("off");
  });

  it("a shortcut taken by another app: the old one stays and the reason is shown until the next try", async () => {
    await show();
    open("Quick access");
    const hotkey = select("Quick add from anywhere");
    mocks.setQuickHotkey.mockImplementationOnce(failing);
    fireEvent.change(hotkey, { target: { value: "ctrl+shift+space" } });
    await error("Another app already uses this shortcut. Choose another one.");
    expect(hotkey.value).toBe("ctrl+alt+space");
    fireEvent.change(hotkey, { target: { value: "alt+shift+space" } });
    expect(screen.queryByText(/Another app already uses/)).toBeNull();
  });

  it("widget, on top and launch with Windows show what the app reports and change it", async () => {
    mocks.readDesktop.mockResolvedValueOnce({ widget: true, on_top: false, autostart: true });
    await show();
    open("Quick access");
    expect(toggle("Desktop widget").checked).toBe(true);
    expect(toggle("Keep the widget on top").checked).toBe(false);
    expect(toggle("Start with Windows").checked).toBe(true);
    fireEvent.click(toggle("Desktop widget"));
    expect(mocks.setWidget).toHaveBeenLastCalledWith({ visible: false });
    fireEvent.click(toggle("Keep the widget on top"));
    expect(mocks.setWidget).toHaveBeenLastCalledWith({ onTop: true });
    expect(toggle("Keep the widget on top").checked).toBe(true);
    fireEvent.click(toggle("Start with Windows"));
    expect(mocks.setAutostart).toHaveBeenLastCalledWith(false);
    await waitFor(() => expect(toggle("Start with Windows").checked).toBe(false));
  });

  it("launch with Windows shows what really happened: off in Task Manager stays off", async () => {
    mocks.setAutostart.mockResolvedValueOnce(false);
    await show();
    open("Quick access");
    fireEvent.click(toggle("Start with Windows"));
    expect(toggle("Start with Windows").checked).toBe(true);
    await waitFor(() => expect(toggle("Start with Windows").checked).toBe(false));
  });

  it("each failed switch turns back and says so", async () => {
    await show();
    open("Quick access");
    for (const label of ["Desktop widget", "Keep the widget on top", "Start with Windows"]) {
      mocks.setWidget.mockImplementationOnce(failing);
      mocks.setAutostart.mockImplementationOnce(failing);
      fireEvent.click(toggle(label));
      await waitFor(() => expect(toggle(label).checked).toBe(false));
    }
    expect(screen.getByText("Couldn't save the setting")).toBeTruthy();
  });

  it("a late answer of an older change doesn't undo a newer one", async () => {
    let fail = () => {};
    mocks.setWidget.mockImplementationOnce(() => new Promise((_, reject) => (fail = () => reject(new Error("late")))));
    await show();
    open("Quick access");
    fireEvent.click(toggle("Desktop widget"));
    fireEvent.click(toggle("Desktop widget"));
    fireEvent.click(toggle("Desktop widget"));
    await act(async () => fail());
    expect(toggle("Desktop widget").checked).toBe(true);
    expect(screen.queryByText("Couldn't save the setting")).toBeNull();
  });

  it("a change made before the first read is not overwritten by it", async () => {
    let read = (_d: Desktop) => {};
    mocks.readDesktop.mockImplementationOnce(() => new Promise((r) => (read = r)));
    let settings = (_s: Settings) => {};
    mocks.readSettings.mockImplementationOnce(() => new Promise((r) => (settings = r)));
    await show();
    open("Quick access");
    fireEvent.click(toggle("Desktop widget"));
    fireEvent.change(select("Quick add from anywhere"), { target: { value: "alt+shift+space" } });
    await act(async () => read({ widget: false, on_top: true, autostart: false }));
    await act(async () => settings({ notifications: true, private_notifications: false, alerts: "off", quick_hotkey: "ctrl+alt+space" }));
    expect(toggle("Desktop widget").checked).toBe(true);
    expect(toggle("Keep the widget on top").checked).toBe(true);
    expect(select("Quick add from anywhere").value).toBe("alt+shift+space");
    open("Reminders");
    expect(toggle("Event notifications").checked).toBe(true);
  });

  it("in a browser the switches are off", async () => {
    mocks.tauri = false;
    await show();
    open("Quick access");
    expect(select("Quick add from anywhere").disabled).toBe(true);
    for (const label of ["Desktop widget", "Keep the widget on top", "Start with Windows"]) expect(toggle(label).disabled).toBe(true);
  });
});

describe("Help", () => {
  it("the log folder opens; a failure says so", async () => {
    await show();
    open("Help");
    fireEvent.click(screen.getByRole("button", { name: "Open log folder" }));
    expect(mocks.openLogsFolder).toHaveBeenCalled();
    mocks.openLogsFolder.mockImplementationOnce(failing);
    fireEvent.click(screen.getByRole("button", { name: "Open log folder" }));
    await error("Couldn't save the setting");
  });

  it("a browser has no log folder", async () => {
    mocks.tauri = false;
    await show();
    open("Help");
    expect(screen.queryByRole("button", { name: "Open log folder" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Write to us" })).toBeTruthy();
  });
});

describe("settings in detail", () => {
  const cls = (el: Element | null | undefined) => el?.className ?? "";

  it("the open section, the theme and the style are highlighted", async () => {
    mocks.tauri = false;
    await show();
    expect(cls(tab("Appearance"))).toContain("navActive");
    expect(cls(tab("Help"))).not.toContain("navActive");
    expect(tab("Help").getAttribute("aria-controls")).toBe("settings-panel-help");
    const theme = (name: string) => within(screen.getByRole("radiogroup", { name: "Theme" })).getByRole("radio", { name });
    fireEvent.click(theme("Light"));
    expect(cls(theme("Light"))).toContain("active");
    expect(cls(theme("Dark"))).not.toContain("active");
    const style = (name: RegExp) => within(screen.getByRole("radiogroup", { name: "Style" })).getByRole("radio", { name });
    fireEvent.click(style(/Monochrome/));
    expect(cls(style(/Monochrome/))).toContain("styleActive");
    expect(style(/Classic/).getAttribute("aria-checked")).toBe("false");
    expect(cls(style(/Classic/))).not.toContain("styleActive");
  });

  it("each font is shown in itself; the style default in the style's font", async () => {
    await show();
    const display = screen.getByRole("combobox", { name: "Heading and number font" }) as HTMLSelectElement;
    expect(display.style.fontFamily).toContain("Segoe");
    expect(display.options[0].style.fontFamily).toContain("Segoe");
    const inter = [...display.options].find((o) => o.value === "inter") as HTMLOptionElement;
    expect(inter.style.fontFamily).toContain("Inter");
  });

  it("arrow keys don't scroll the page", async () => {
    await show();
    expect(fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowDown" })).toBe(false);
    expect(fireEvent.keyDown(screen.getByRole("tablist"), { key: "Tab" })).toBe(true);
  });

  it("a theme or look chosen in another window shows here too", async () => {
    mocks.tauri = false;
    await show();
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "calm.theme", newValue: JSON.stringify("dark") }));
      window.dispatchEvent(new StorageEvent("storage", { key: "calm.appearance", newValue: JSON.stringify({ style: "paper", display: "auto", text: "auto" }) }));
    });
    expect(within(screen.getByRole("radiogroup", { name: "Theme" })).getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe("true");
    expect(within(screen.getByRole("radiogroup", { name: "Style" })).getByRole("radio", { name: /Paper/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("once closed, Esc no longer reaches it", async () => {
    const { onClose } = await show();
    cleanup();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("before the app answers, everything shows off", async () => {
    mocks.readSettings.mockImplementationOnce(() => new Promise(() => {}));
    mocks.readDesktop.mockImplementationOnce(() => new Promise(() => {}));
    await show();
    open("Reminders");
    expect(toggle("Event notifications").checked).toBe(false);
    expect(toggle("Hide titles").checked).toBe(false);
    expect(select("Hard-to-miss alert").value).toBe("off");
    open("Quick access");
    for (const label of ["Desktop widget", "Keep the widget on top", "Start with Windows"]) expect(toggle(label).checked).toBe(false);
  });

  it("changes made before the first read are kept for every setting", async () => {
    let read = (_d: Desktop) => {};
    mocks.readDesktop.mockImplementationOnce(() => new Promise((r) => (read = r)));
    let settings = (_s: Settings) => {};
    mocks.readSettings.mockImplementationOnce(() => new Promise((r) => (settings = r)));
    await show();
    open("Quick access");
    fireEvent.click(toggle("Keep the widget on top"));
    fireEvent.click(toggle("Start with Windows"));
    open("Reminders");
    fireEvent.click(toggle("Event notifications"));
    fireEvent.click(toggle("Hide titles"));
    fireEvent.change(select("Hard-to-miss alert"), { target: { value: "all" } });
    await act(async () => read({ widget: true, on_top: false, autostart: false }));
    await act(async () => settings({ notifications: false, private_notifications: false, alerts: "calls", quick_hotkey: "ctrl+alt+space" }));
    expect(toggle("Event notifications").checked).toBe(true);
    expect(toggle("Hide titles").checked).toBe(true);
    expect(select("Hard-to-miss alert").value).toBe("all");
    open("Quick access");
    expect(toggle("Desktop widget").checked).toBe(true);
    expect(toggle("Keep the widget on top").checked).toBe(true);
    expect(toggle("Start with Windows").checked).toBe(true);
  });

  it("a late failure of an older change undoes nothing, for every setting", async () => {
    const fails: (() => void)[] = [];
    const late = () => new Promise<never>((_, reject) => fails.push(() => reject(new Error("late"))));
    mocks.readSettings.mockResolvedValueOnce({ notifications: true, private_notifications: false, alerts: "off", quick_hotkey: "ctrl+alt+space" });
    for (const fn of [mocks.setWidget, mocks.setNotifications, mocks.setPrivateNotifications, mocks.setAlerts, mocks.setQuickHotkey]) {
      fn.mockImplementationOnce(late);
    }
    mocks.setAutostart.mockImplementationOnce(late);
    await show();
    open("Quick access");
    fireEvent.click(toggle("Keep the widget on top"));
    fireEvent.click(toggle("Keep the widget on top"));
    fireEvent.click(toggle("Start with Windows"));
    fireEvent.click(toggle("Start with Windows"));
    fireEvent.change(select("Quick add from anywhere"), { target: { value: "alt+shift+space" } });
    fireEvent.change(select("Quick add from anywhere"), { target: { value: "ctrl+shift+space" } });
    open("Reminders");
    fireEvent.click(toggle("Hide titles"));
    fireEvent.click(toggle("Hide titles"));
    fireEvent.change(select("Hard-to-miss alert"), { target: { value: "calls" } });
    fireEvent.change(select("Hard-to-miss alert"), { target: { value: "all" } });
    fireEvent.click(toggle("Event notifications"));
    fireEvent.click(toggle("Event notifications"));
    await act(async () => fails.forEach((fail) => fail()));
    expect(screen.queryByText(/Couldn't/)).toBeNull();
    expect(toggle("Event notifications").checked).toBe(true);
    expect(toggle("Hide titles").checked).toBe(false);
    expect(select("Hard-to-miss alert").value).toBe("all");
    open("Quick access");
    expect(select("Quick add from anywhere").value).toBe("ctrl+shift+space");
    expect(screen.queryByText(/Another app already uses/)).toBeNull();
    expect(toggle("Keep the widget on top").checked).toBe(false);
    expect(toggle("Start with Windows").checked).toBe(false);
  });

  it("an older launch answer arriving late doesn't override a newer one", async () => {
    let first = (_v: boolean) => {};
    mocks.setAutostart.mockImplementationOnce(() => new Promise((r) => (first = r)));
    await show();
    open("Quick access");
    fireEvent.click(toggle("Start with Windows"));
    fireEvent.click(toggle("Start with Windows"));
    await act(async () => {});
    await act(async () => first(true));
    expect(toggle("Start with Windows").checked).toBe(false);
  });

  it("a successful change takes an old error away", async () => {
    mocks.setGlass.mockImplementationOnce(failing);
    await show();
    fireEvent.click(toggle("Glass effect"));
    await error("Couldn't change the glass effect");
    fireEvent.click(toggle("Glass effect"));
    expect(screen.queryByText("Couldn't change the glass effect")).toBeNull();
    mocks.setGlass.mockImplementationOnce(failing);
    fireEvent.click(toggle("Glass effect"));
    await error("Couldn't change the glass effect");
    open("Reminders");
    open("Appearance");
    mocks.setNotifications.mockImplementationOnce(failing);
    open("Reminders");
    fireEvent.click(toggle("Event notifications"));
    await error("Couldn't change notifications");
    fireEvent.change(select("Hard-to-miss alert"), { target: { value: "all" } });
    expect(screen.queryByText("Couldn't change notifications")).toBeNull();
    mocks.setNotifications.mockImplementationOnce(failing);
    fireEvent.click(toggle("Event notifications"));
    await error("Couldn't change notifications");
    fireEvent.click(toggle("Event notifications"));
    expect(screen.queryByText("Couldn't change notifications")).toBeNull();
  });

  it("hidden titles work only with notifications on", async () => {
    mocks.readSettings.mockResolvedValueOnce({ notifications: true, private_notifications: false, alerts: "off", quick_hotkey: null });
    await show();
    open("Reminders");
    expect(toggle("Hide titles").disabled).toBe(false);
  });

  it("the saved holiday country is chosen", async () => {
    await show({}, [[$holidayRegion, "PL"]]);
    open("Calendar");
    expect(select("Holidays").value).toBe("PL");
  });

  it("subscriptions: no list without them, each with its color, the field locked while downloading", async () => {
    let done = (_c: { name?: string }) => {};
    mocks.downloadFeed.mockImplementationOnce(() => new Promise((r) => (done = r)));
    await show({}, [[$feeds, [{ id: "f1", url: "https://example.com/a.ics", name: "A", color: "rgb(255, 0, 0)" }]]]);
    open("Calendar");
    expect((screen.getByText("A").previousElementSibling as HTMLElement).style.background).toBe("rgb(255, 0, 0)");
    const field = screen.getByRole("textbox", { name: "Calendar link (.ics)" }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "https://example.com/b.ics" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(field.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => done({ name: "B" }));
    expect(field.disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Remove A" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove B" }));
    expect(document.querySelector("[class*=feeds]")).toBeNull();
    expect(document.querySelector("[class*=error]")).toBeNull();
  });

  it("submitting a subscription doesn't reload the page", async () => {
    await show();
    open("Calendar");
    const field = screen.getByRole("textbox", { name: "Calendar link (.ics)" }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "https://example.com/c.ics" } });
    expect(fireEvent.submit(field.form as HTMLFormElement)).toBe(false);
    await waitFor(() => expect(mocks.downloadFeed).toHaveBeenCalled());
  });

  it("no shortcut error until one fails", async () => {
    await show();
    open("Quick access");
    expect(document.querySelector("[class*=error]")).toBeNull();
  });
});
