import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import { recall, remember } from "./cache";
import type { AppError } from "./types";

const invoke = vi.hoisted(() => vi.fn());
const logWarn = vi.hoisted(() => vi.fn());
const host = vi.hoisted(() => ({ tauri: true }));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("./bus", () => ({
  get inTauri() {
    return host.tauri;
  },
}));
vi.mock("../lib/log", () => ({ logWarn }));

const bridge = await import("./bridge");
const { cancelSignIn, fetchFeed, getAuthStatus, googleRequest, isAppError, reopenSignIn, saveClientConfig, signIn, signOut, toAppError } =
  bridge;

beforeEach(() => {
  host.tauri = true;
  invoke.mockReset();
  logWarn.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

const failWith = (error: unknown) => invoke.mockRejectedValueOnce(error);
const caught = (promise: Promise<unknown>): Promise<AppError> => promise.then(() => expect.fail("expected a failure"), (e) => e);

describe("app errors", () => {
  it("only an object with a kind and a message is an app error", () => {
    expect(isAppError({ kind: "network", message: "x" })).toBe(true);
    expect(isAppError({ kind: "network" })).toBe(false);
    expect(isAppError({ message: "x" })).toBe(false);
    expect(isAppError(null)).toBe(false);
    expect(isAppError("network")).toBe(false);
  });

  it("anything thrown becomes an app error with a readable message", () => {
    const own: AppError = { kind: "timeout", message: "late" };
    expect(toAppError(own)).toBe(own);
    expect(toAppError(new Error("boom"))).toEqual({ kind: "other", message: "boom" });
    expect(toAppError("plain text")).toEqual({ kind: "other", message: "plain text" });
  });
});

describe("errors from Rust", () => {
  it("known kinds get the text in the UI language", async () => {
    const texts: [AppError["kind"], string][] = [
      ["not_configured", t.errors.notConfigured],
      ["not_signed_in", t.errors.notSignedIn],
      ["denied", t.errors.denied],
      ["timeout", t.errors.timeout],
      ["missing_scope", t.errors.missingScope],
      ["network", t.errors.network],
    ];
    for (const [kind, text] of texts) {
      failWith({ kind, message: "technical details" });
      expect(await caught(getAuthStatus())).toEqual({ kind, message: text });
    }
  });

  it("a Google error keeps its details and its status code", async () => {
    failWith({ kind: "google", message: "403: Rate limit exceeded\nretry later" });
    expect(await caught(googleRequest("me@x", "GET", "/p"))).toEqual({
      kind: "google",
      message: `${t.errors.google(403)}. Rate limit exceeded\nretry later`,
      status: 403,
    });
  });

  it("a Google error without a status code and other errors keep their text", async () => {
    failWith({ kind: "google", message: "connection reset" });
    expect(await caught(googleRequest("me@x", "GET", "/p"))).toEqual({ kind: "google", message: "connection reset" });
    failWith({ kind: "other", message: "403: not from Google" });
    expect(await caught(getAuthStatus())).toEqual({ kind: "other", message: "403: not from Google" });
    failWith(new Error("disk full"));
    expect(await caught(getAuthStatus())).toEqual({ kind: "other", message: "disk full" });
  });

  it("a failed command goes to the log with its original error", async () => {
    const error = { kind: "network", message: "dns" };
    failWith(error);
    await caught(fetchFeed("https://example.com/a.ics"));
    expect(logWarn).toHaveBeenCalledWith("command fetch_feed failed", error);
  });

  it("Rust logs its own commands, and an expired or cancelled sign-in is not a failure", async () => {
    failWith({ kind: "google", message: "500: x" });
    await caught(googleRequest("me@x", "GET", "/p"));
    failWith({ kind: "denied", message: "x" });
    await caught(signIn());
    failWith({ kind: "not_signed_in", message: "x" });
    await caught(getAuthStatus());
    failWith({ kind: "cancelled", message: "x" });
    await caught(reopenSignIn());
    expect(logWarn).not.toHaveBeenCalled();
  });
});

describe("commands", () => {
  it("sign-in status arrives in the app's field names", async () => {
    invoke.mockResolvedValueOnce({ client_source: "file", accounts: [{ email: "me@x", signed_in: false }] });
    expect(await getAuthStatus()).toEqual({ clientSource: "file", accounts: [{ email: "me@x", signedIn: false }] });
    expect(invoke).toHaveBeenCalledWith("auth_status", undefined);
  });

  it("a Google request sends the query as pairs, and nothing when there is no query", async () => {
    invoke.mockResolvedValue({ ok: true });
    expect(await googleRequest("me@x", "PATCH", "/p", { a: "1", b: "2" }, { summary: "x" })).toEqual({ ok: true });
    expect(invoke).toHaveBeenLastCalledWith("google_request", {
      account: "me@x",
      method: "PATCH",
      path: "/p",
      query: [["a", "1"], ["b", "2"]],
      body: { summary: "x" },
    });
    await googleRequest("me@x", "GET", "/p");
    expect(invoke).toHaveBeenLastCalledWith("google_request", { account: "me@x", method: "GET", path: "/p", query: undefined, body: undefined });
  });

  it("other commands pass their arguments to Rust", async () => {
    invoke.mockResolvedValue("me@x");
    expect(await signIn()).toBe("me@x");
    await reopenSignIn();
    await cancelSignIn();
    await saveClientConfig("id", "secret");
    await fetchFeed("webcal://example.com/a.ics");
    expect(invoke.mock.calls).toEqual([
      ["sign_in", undefined],
      ["sign_in_reopen", undefined],
      ["sign_in_cancel", undefined],
      ["save_client_config", { clientId: "id", clientSecret: "secret" }],
      ["fetch_feed", { url: "webcal://example.com/a.ics" }],
    ]);
  });

  it("signing out of one account or all of them erases saved responses, even when it fails", async () => {
    invoke.mockResolvedValueOnce(null);
    remember("k", "saved");
    await signOut("me@x");
    expect(invoke).toHaveBeenLastCalledWith("sign_out", { account: "me@x" });
    expect(recall("k")).toBeUndefined();

    remember("k", "saved");
    failWith({ kind: "other", message: "x" });
    await caught(signOut());
    expect(invoke).toHaveBeenLastCalledWith("sign_out", {});
    expect(recall("k")).toBeUndefined();
  });
});

describe("where commands run", () => {
  const callEverything = () => {
    const calls = [
      getAuthStatus(),
      signIn(),
      reopenSignIn(),
      cancelSignIn(),
      signOut("nobody@x"),
      saveClientConfig("id", "secret"),
      googleRequest("me@x", "GET", "/calendar/v3/users/me/calendarList"),
      fetchFeed("https://example.com/a.ics"),
    ];
    calls.forEach((p) => p.catch(() => {}));
  };

  it("in a browser without Tauri the commands work on mock data", async () => {
    host.tauri = false;
    callEverything();
    expect(await getAuthStatus()).toMatchObject({ clientSource: "file" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("the build for app autotests sends sign-in and Google requests to mock data even inside Tauri", async () => {
    vi.stubEnv("VITE_CALM_MOCK", "1");
    vi.resetModules();
    const mocked = await import("./bridge");
    invoke.mockResolvedValue(null);
    await Promise.allSettled([
      mocked.getAuthStatus(),
      mocked.reopenSignIn(),
      mocked.cancelSignIn(),
      mocked.signOut("nobody@x"),
      mocked.saveClientConfig("id", "secret"),
    ]);
    for (const p of [mocked.signIn(), mocked.googleRequest("me@x", "GET", "/x"), mocked.fetchFeed("https://example.com/a.ics")]) p.catch(() => {});
    expect(invoke).not.toHaveBeenCalled();
  });
});
