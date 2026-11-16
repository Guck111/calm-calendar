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

describe("состояние входа", () => {
  it("токен есть, а файла клиента нет — просим клиента, а не показываем календарь с ошибкой", async () => {
    expect(await run("none", [me])).toMatchObject({ signedIn: false, needsClient: true });
  });

  it("клиент и токен на месте — вход действует", async () => {
    expect(await run("file", [me])).toMatchObject({ signedIn: true, needsClient: false });
  });

  it("аккаунт, где вход истёк, не читается, а остальные работают", async () => {
    expect(await run("build", [{ ...me, signedIn: false }, work])).toMatchObject({
      signedIn: true,
      active: ["work@company.com"],
    });
  });

  it("отменённый вход — не ошибка, а настоящая ошибка входа видна", async () => {
    const cancelled = fork({ handlers: [[signInFx, () => Promise.reject({ kind: "cancelled", message: "" })]] });
    await allSettled(signInFx, { scope: cancelled });
    expect(cancelled.getState($authError)).toBeNull();

    const failed = fork({ handlers: [[signInFx, () => Promise.reject({ kind: "timeout", message: "Время вышло" })]] });
    await allSettled(signInFx, { scope: failed });
    expect(failed.getState($authError)).toBe("Время вышло");
  });

  it("«Отменить» и «Открыть снова» во время входа уходят в Rust", async () => {
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

  it("если вход истёк везде, показываем экран входа", async () => {
    expect(await run("build", [{ ...me, signedIn: false }])).toMatchObject({ signedIn: false, active: [] });
  });
});
