import { allSettled, fork } from "effector";
import { describe, expect, it } from "vitest";
import type { Account, AuthStatus } from "../shared/api/types";
import {
  $activeAccounts,
  $authError,
  $needsClient,
  $signedIn,
  cancelSignInFx,
  fetchStatusFx,
  reopenSignInFx,
  signInCancelClicked,
  signInFx,
  signInReopenClicked,
} from "./auth";

const run = async (clientSource: AuthStatus["clientSource"], accounts: Account[]) => {
  const scope = fork({ handlers: [[fetchStatusFx, () => ({ clientSource, accounts })]] });
  await allSettled(fetchStatusFx, { scope });
  return {
    signedIn: scope.getState($signedIn),
    needsClient: scope.getState($needsClient),
    active: scope.getState($activeAccounts),
  };
};

const me = { email: "me@gmail.com", signedIn: true };
const work = { email: "work@company.com", signedIn: true };

describe("sign-in state", () => {
  it("token exists but client file is missing — ask for the client instead of showing the calendar with an error", async () => {
    expect(await run("none", [me])).toMatchObject({ signedIn: false, needsClient: true });
  });

  it("client and token in place — sign-in is valid", async () => {
    expect(await run("file", [me])).toMatchObject({ signedIn: true, needsClient: false });
  });

  it("account with expired sign-in is not read, the others work", async () => {
    expect(await run("build", [{ ...me, signedIn: false }, work])).toMatchObject({
      signedIn: true,
      active: ["work@company.com"],
    });
  });

  it("cancelled sign-in is not an error, but a real sign-in error is shown", async () => {
    const cancelled = fork({ handlers: [[signInFx, () => Promise.reject({ kind: "cancelled", message: "" })]] });
    await allSettled(signInFx, { scope: cancelled });
    expect(cancelled.getState($authError)).toBeNull();

    const failed = fork({ handlers: [[signInFx, () => Promise.reject({ kind: "timeout", message: "Время вышло" })]] });
    await allSettled(signInFx, { scope: failed });
    expect(failed.getState($authError)).toBe("Время вышло");
  });

  it("'Cancel' and 'Open again' during sign-in go to Rust", async () => {
    const calls: string[] = [];
    const scope = fork({
      handlers: [
        [cancelSignInFx, () => void calls.push("cancel")],
        [reopenSignInFx, () => void calls.push("reopen")],
      ],
    });
    await allSettled(signInReopenClicked, { scope });
    await allSettled(signInCancelClicked, { scope });
    expect(calls).toEqual(["reopen", "cancel"]);
  });

  it("if sign-in expired everywhere, show the sign-in screen", async () => {
    expect(await run("build", [{ ...me, signedIn: false }])).toMatchObject({ signedIn: false, active: [] });
  });
});
