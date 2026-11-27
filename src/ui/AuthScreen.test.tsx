// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { allSettled, fork, type Scope } from "effector";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { $authError, $status, saveClientFx, signInFx } from "../model/auth";
import type { AuthStatus } from "../shared/api/types";
import { setLang } from "../shared/i18n";
import { renderIn } from "./app-scope.test-utils";
import { AuthScreen } from "./AuthScreen";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 11, 12));
  setLang("en");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setLang("ru");
});

const status = (clientSource: AuthStatus["clientSource"]): AuthStatus => ({ clientSource, accounts: [] });

const show = async ({
  source = "build" as AuthStatus["clientSource"] | null,
  error = null as string | null,
  save = vi.fn(async (_c: { clientId: string; clientSecret: string }) => {}),
  signIn = vi.fn(async () => "me@example.com"),
} = {}) => {
  const scope: Scope = fork({
    values: [[$status, source ? status(source) : null], [$authError, error]] as never,
    handlers: [[saveClientFx, save], [signInFx, signIn]] as never,
  });
  // $needsClient follows $status updates: set it as an update, not as a starting value
  if (source) await allSettled($status, { scope, params: status(source) });
  const view = renderIn(scope, <AuthScreen />);
  return { scope, save, signIn, view };
};

const button = (name: string | RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;
const clientId = () => screen.getByRole("textbox", { name: "Client ID or JSON" }) as HTMLTextAreaElement;
const secret = () => screen.queryByLabelText("Client secret") as HTMLInputElement | null;

describe("before the status is known", () => {
  it("shows nothing", async () => {
    const { view } = await show({ source: null });
    expect(view.container.innerHTML).toBe("");
  });
});

describe("sign-in", () => {
  it("the app's name, today's date on the logo and the button", async () => {
    const { view } = await show();
    expect(screen.getByRole("heading", { name: "Calm Calendar" })).toBeTruthy();
    expect(view.container.querySelector("[aria-hidden]")?.textContent).toBe("11");
    expect(screen.getByText("An ad-free calendar. Sign in to Google to see your events.")).toBeTruthy();
    expect(button("Sign in with Google").className).toContain("primary");
    expect(view.container.querySelector("[class*=error]")).toBeNull();
  });

  it("signing in waits for the browser, with a hint and a way out", async () => {
    let finish = () => {};
    const { signIn } = await show({ source: "file", signIn: vi.fn(() => new Promise<string>((r) => (finish = () => r("me@example.com")))) });
    expect(screen.queryByText(/If no tab opened/)).toBeNull();
    fireEvent.click(button("Sign in with Google"));
    expect(signIn).toHaveBeenCalledTimes(1);
    const waiting = button("Finish signing in in your browser…");
    expect(waiting.disabled).toBe(true);
    expect(screen.getByText("If no tab opened, check whether the browser is minimized.")).toBeTruthy();
    expect(button("Open the sign-in page again").parentElement?.className).toContain("center");
    expect(screen.queryByRole("button", { name: "Change OAuth client" })).toBeNull();
    await act(async () => finish());
    expect(button("Sign in with Google").disabled).toBe(false);
  });

  it("an error is shown above the button", async () => {
    await show({ error: "Sign-in timed out" });
    expect(screen.getByText("Sign-in timed out")).toBeTruthy();
  });

  it("a personal build's own client can be changed; a built-in one can't", async () => {
    await show({ source: "file" });
    fireEvent.click(button("Change OAuth client"));
    expect(screen.getByRole("heading", { name: "Connect to Google" })).toBeTruthy();
    fireEvent.click(button("Cancel"));
    expect(button("Sign in with Google")).toBeTruthy();
    cleanup();
    await show({ source: "build" });
    expect(screen.queryByRole("button", { name: "Change OAuth client" })).toBeNull();
  });
});

describe("OAuth client form", () => {
  it("without a client it asks for one: the ID line has the focus, Save waits for text", async () => {
    await show({ source: "none" });
    expect(screen.getByRole("heading", { name: "Connect to Google" })).toBeTruthy();
    expect(document.activeElement).toBe(clientId());
    expect(clientId().placeholder).toBe("1234567890-abc.apps.googleusercontent.com");
    expect(clientId().getAttribute("spellcheck")).toBe("false");
    expect(clientId().rows).toBe(2);
    expect(secret()?.type).toBe("password");
    expect(button("Save").disabled).toBe(true);
    fireEvent.change(clientId(), { target: { value: "   " } });
    expect(button("Save").disabled).toBe(true);
    // the first start has no client to go back to
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("Save sends the ID and the secret", async () => {
    const { save } = await show({ source: "none" });
    fireEvent.change(clientId(), { target: { value: "123.apps.googleusercontent.com" } });
    fireEvent.change(secret() as HTMLInputElement, { target: { value: "s3cret" } });
    expect(fireEvent.submit(clientId().closest("form") as HTMLFormElement)).toBe(false);
    expect(save).toHaveBeenCalledWith({ clientId: "123.apps.googleusercontent.com", clientSecret: "s3cret" });
  });

  it("a pasted JSON file needs no separate secret and gets a taller field", async () => {
    await show({ source: "none" });
    fireEvent.change(clientId(), { target: { value: '  {"installed": {}}' } });
    expect(secret()).toBeNull();
    expect(clientId().rows).toBe(6);
  });

  it("while saving Save is locked; an error is shown", async () => {
    await show({ source: "none", error: "Not a client ID", save: vi.fn(() => new Promise<void>(() => {})) });
    expect(screen.getByText("Not a client ID")).toBeTruthy();
    fireEvent.change(clientId(), { target: { value: "123" } });
    fireEvent.click(button("Save"));
    await act(async () => {});
    expect(button("Save").disabled).toBe(true);
  });
});

describe("client form details", () => {
  it("the secret is not spell-checked; Save opens up once there is an ID; no error line without an error", async () => {
    const { view } = await show({ source: "none" });
    expect(secret()?.getAttribute("spellcheck")).toBe("false");
    expect(view.container.querySelector("[class*=error]")).toBeNull();
    fireEvent.change(clientId(), { target: { value: "123" } });
    expect(button("Save").disabled).toBe(false);
    fireEvent.click(button("Save"));
  });
});
