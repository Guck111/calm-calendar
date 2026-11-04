import { allSettled, fork } from "effector";
import { describe, expect, it } from "vitest";
import { $needsClient, $signedIn, fetchStatusFx } from "./auth";

const run = async (status: { clientSource: "build" | "file" | "none"; signedIn: boolean }) => {
  const scope = fork({ handlers: [[fetchStatusFx, () => ({ ...status, email: null })]] });
  await allSettled(fetchStatusFx, { scope });
  return { signedIn: scope.getState($signedIn), needsClient: scope.getState($needsClient) };
};

describe("состояние входа", () => {
  it("токен есть, а файла клиента нет — просим клиента, а не показываем календарь с ошибкой", async () => {
    expect(await run({ clientSource: "none", signedIn: true })).toEqual({ signedIn: false, needsClient: true });
  });

  it("клиент и токен на месте — вход действует", async () => {
    expect(await run({ clientSource: "file", signedIn: true })).toEqual({ signedIn: true, needsClient: false });
  });
});
