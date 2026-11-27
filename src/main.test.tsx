// @vitest-environment jsdom
// One page for every window: ?window= picks what it draws; looks and language are set up before the first render
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mocks, step } = vi.hoisted(() => {
  const mocks = {
    render: vi.fn(),
    createRoot: vi.fn(),
    setup: [] as string[],
    App: () => null,
    Widget: () => null,
    AlertWindow: () => null,
    AgendaWindow: () => null,
    QuickWindow: () => null,
    SettingsWindow: () => null,
  };
  /** a setup call that only records itself */
  const step =
    (name: string, result?: unknown) =>
    (...args: unknown[]) => {
      mocks.setup.push(args.length ? `${name}(${args.join()})` : name);
      return result;
    };
  return { mocks, step };
});

vi.mock("react-dom/client", () => ({ createRoot: mocks.createRoot }));
vi.mock("./app/App", () => ({ App: mocks.App }));
vi.mock("./widget/Widget", () => ({ Widget: mocks.Widget }));
vi.mock("./alert/AlertWindow", () => ({ AlertWindow: mocks.AlertWindow }));
vi.mock("./agenda/AgendaWindow", () => ({ AgendaWindow: mocks.AgendaWindow }));
vi.mock("./quick/QuickWindow", () => ({ QuickWindow: mocks.QuickWindow }));
vi.mock("./settings/SettingsWindow", () => ({ SettingsWindow: mocks.SettingsWindow }));
vi.mock("./shared/lib/log", async (real) => ({ ...(await real<object>()), catchUnhandled: step("catchUnhandled") }));
vi.mock("./shared/lib/glass", () => ({ initGlass: step("initGlass") }));
vi.mock("./shared/lib/theme", () => ({
  readTheme: step("readTheme", "dark"),
  applyTheme: step("applyTheme"),
  followTheme: step("followTheme"),
}));
vi.mock("./shared/lib/appearance", () => ({
  readAppearance: step("readAppearance", "soft"),
  applyAppearance: step("applyAppearance"),
  followAppearance: step("followAppearance"),
}));
vi.mock("./shared/i18n", async (real) => ({
  ...(await real<object>()),
  followLang: step("followLang"),
  syncLangToRust: step("syncLangToRust", Promise.resolve()),
}));

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  mocks.setup.length = 0;
  mocks.render.mockClear();
  mocks.createRoot.mockClear().mockImplementation(() => ({ render: mocks.render }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  window.history.replaceState(null, "", "/");
  delete document.documentElement.dataset.window;
});

/** open the page at the address; what it rendered: the window and whether its error screen is compact */
const open = async (search: string) => {
  window.history.replaceState(null, "", `/${search}`);
  mocks.render.mockClear();
  mocks.createRoot.mockClear();
  vi.resetModules();
  await import("./main");
  const { StrictMode } = await import("react");
  const { ErrorBoundary } = await import("./ui/ErrorBoundary");
  expect(mocks.createRoot).toHaveBeenCalledWith(document.getElementById("root"));
  expect(mocks.render).toHaveBeenCalledOnce();
  const strict = mocks.render.mock.calls[0][0] as ReactElement<{ children: ReactElement<{ compact: boolean; children: ReactElement }> }>;
  expect(strict.type).toBe(StrictMode);
  const boundary = strict.props.children;
  expect(boundary.type).toBe(ErrorBoundary);
  return { Root: boundary.props.children.type, compact: boundary.props.compact };
};

describe("the page", () => {
  it.each([
    ["", "main", mocks.App, false],
    ["?window=main", "main", mocks.App, false],
    ["?window=unknown", "main", mocks.App, false],
    ["?window=widget", "widget", mocks.Widget, true],
    ["?window=alert", "alert", mocks.AlertWindow, true],
    ["?window=agenda", "agenda", mocks.AgendaWindow, true],
    ["?window=quick", "quick", mocks.QuickWindow, true],
    ["?window=settings", "settings", mocks.SettingsWindow, true],
  ])("at '%s' is the %s window", async (search, kind, Window, compact) => {
    expect(await open(search)).toEqual({ Root: Window, compact });
    expect(document.documentElement.dataset.window).toBe(kind);
  });

  it("sets up the looks and the language before the first render; only the main window tells Rust the language", async () => {
    mocks.render.mockImplementation(() => mocks.setup.push("render"));
    await open("");
    expect(mocks.setup).toEqual([
      "catchUnhandled",
      "readTheme",
      "applyTheme(dark)",
      "followTheme",
      "readAppearance",
      "applyAppearance(soft)",
      "followAppearance",
      "initGlass",
      "followLang",
      "syncLangToRust",
      "render",
    ]);
    mocks.setup.length = 0;
    await open("?window=widget");
    expect(mocks.setup).not.toContain("syncLangToRust");
    expect(mocks.setup).toContain("followLang");
  });

  it("breaks on purpose at ?crash=1 in development, so autotests can see the error screen", async () => {
    vi.stubEnv("DEV", true);
    const { Root, compact } = await open("?window=widget&crash=1");
    expect(compact).toBe(true);
    expect(Root).not.toBe(mocks.Widget);
    expect(() => (Root as () => never)()).toThrow("test crash (?crash=1)");
  });

  it("never breaks on purpose in a release build", async () => {
    vi.stubEnv("DEV", false);
    expect((await open("?crash=1")).Root).toBe(mocks.App);
  });

  it("draws the window as usual in development without ?crash", async () => {
    vi.stubEnv("DEV", true);
    expect((await open("?window=quick")).Root).toBe(mocks.QuickWindow);
  });
});
