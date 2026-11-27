// @vitest-environment jsdom
// The language setting: stored choice, the system languages, telling Rust and the other window
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { followLang, lang, locale, readLangSetting, saveLangSetting, setLang, syncLangToRust, systemLang, uses12h } from "./index";

const mocks = vi.hoisted(() => ({
  tauri: false,
  invoke: vi.fn(async (_cmd: string, _args?: object): Promise<unknown> => undefined),
  broadcast: vi.fn(),
  listeners: new Map<string, () => void>(),
}));
vi.mock("../api/bus", async (real) => ({
  ...(await real<object>()),
  get inTauri() {
    return mocks.tauri;
  },
  broadcast: mocks.broadcast,
  subscribe: (name: string, handler: () => void) => {
    mocks.listeners.set(name, handler);
    return () => mocks.listeners.delete(name);
  },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

const KEY = "calm.lang";
const reload = vi.fn();

const systemLanguages = (languages: string[], language = languages[0] ?? "") => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(languages);
  vi.spyOn(navigator, "language", "get").mockReturnValue(language);
};

const store = (value: unknown) => localStorage.setItem(KEY, JSON.stringify(value));

/** waits for the language change to tell Rust and reload */
const settled = () => vi.waitFor(() => expect(reload).toHaveBeenCalled());

beforeEach(() => {
  vi.stubGlobal("location", { ...window.location, reload });
  mocks.tauri = false;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  reload.mockReset();
  mocks.invoke.mockReset();
  mocks.broadcast.mockReset();
  mocks.listeners.clear();
  localStorage.clear();
  setLang("ru");
});

describe("the stored language setting", () => {
  it("is the system language until something is chosen", () => {
    expect(readLangSetting()).toBe("system");
    store("system");
    expect(readLangSetting()).toBe("system");
  });

  it("is the chosen language", () => {
    store("de");
    expect(readLangSetting()).toBe("de");
  });

  it.each(["xx", "toString", 5, null, { lang: "de" }])("falls back to the system language for %o", (value) => {
    store(value);
    expect(readLangSetting()).toBe("system");
  });
});

describe("the system language", () => {
  it("is the first system language with a translation, whatever its region", () => {
    systemLanguages(["xx-YY", "PT_pt", "en-US"]);
    expect(systemLang()).toBe("pt");
  });

  it("is English when there is no translation", () => {
    systemLanguages(["xx-YY", "kk"]);
    expect(systemLang()).toBe("en");
  });

  it("comes from the main language when the list is empty", () => {
    systemLanguages([], "uk-UA");
    expect(systemLang()).toBe("uk");
  });
});

describe("the date region", () => {
  it("is the system one for this language, always with the Gregorian calendar", () => {
    systemLanguages(["de-DE", "ar-SA"]);
    setLang("ar");
    expect(locale).toBe("ar-SA-u-ca-gregory");
  });

  it("is the default one when the system has another language", () => {
    systemLanguages(["de-DE"]);
    setLang("pt");
    expect(locale).toBe("pt-BR-u-ca-gregory");
  });

  it("is kept as the system writes it when it is not a valid tag", () => {
    systemLanguages(["en_US"]);
    setLang("en");
    expect(locale).toBe("en_US");
  });
});

describe("the writing direction", () => {
  it("is right to left for Arabic only", () => {
    setLang("ar", "ar-EG");
    expect(document.documentElement.dir).toBe("rtl");
    expect(document.documentElement.lang).toBe("ar");
    setLang("en", "en-GB");
    expect(document.documentElement.dir).toBe("ltr");
  });
});

describe("the 12-hour clock", () => {
  it.each([
    ["en-US", true],
    ["ja-JP-u-hc-h11", true],
    ["de-DE", false],
    ["ru-RU", false],
  ])("in %s: %s", (locale, expected) => {
    setLang("en", locale);
    expect(uses12h()).toBe(expected);
  });
});

describe("telling Rust the language", () => {
  it("passes it to the app", async () => {
    mocks.tauri = true;
    setLang("fr", "fr-FR");
    await syncLangToRust();
    expect(mocks.invoke).toHaveBeenCalledWith("set_language", { language: "fr" });
  });

  it("does nothing in a browser", async () => {
    await syncLangToRust();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("does not fail when the app refuses", async () => {
    mocks.tauri = true;
    mocks.invoke.mockRejectedValue(new Error("no window"));
    await expect(syncLangToRust()).resolves.toBeUndefined();
  });
});

describe("changing the language", () => {
  it("remembers it, applies it, tells Rust and the other window, then reloads", async () => {
    mocks.tauri = true;
    saveLangSetting("es");
    expect(JSON.parse(localStorage.getItem(KEY)!)).toBe("es");
    expect(lang).toBe("es");
    await settled();
    expect(mocks.invoke).toHaveBeenCalledWith("set_language", { language: "es" });
    expect(mocks.broadcast).toHaveBeenCalledWith("lang-changed", "es");
  });

  it("to the system one takes the system language", async () => {
    systemLanguages(["de-AT"]);
    saveLangSetting("system");
    expect(JSON.parse(localStorage.getItem(KEY)!)).toBe("system");
    expect(lang).toBe("de");
    await settled();
    expect(mocks.broadcast).toHaveBeenCalledWith("lang-changed", "system");
  });
});

describe("following the language of another window", () => {
  const storageEvent = (key: string) => window.dispatchEvent(new StorageEvent("storage", { key }));

  it("reloads when the stored language differs from the current one", () => {
    const off = followLang();
    store("ru");
    storageEvent(KEY);
    mocks.listeners.get("lang-changed")?.();
    expect(reload).not.toHaveBeenCalled();

    store("ja");
    storageEvent("calm.view");
    expect(reload).not.toHaveBeenCalled();
    storageEvent(KEY);
    expect(reload).toHaveBeenCalledTimes(1);
    mocks.listeners.get("lang-changed")?.();
    expect(reload).toHaveBeenCalledTimes(2);
    off();
  });

  it("stops once turned off", () => {
    const off = followLang();
    expect(mocks.listeners.has("lang-changed")).toBe(true);
    off();
    expect(mocks.listeners.size).toBe(0);
    store("ja");
    storageEvent(KEY);
    expect(reload).not.toHaveBeenCalled();
  });
});
