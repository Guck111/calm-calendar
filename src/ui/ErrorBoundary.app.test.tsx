// @vitest-environment jsdom
// The error screen inside the app (Tauri): it also offers the log folder for a letter to support
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../shared/i18n";
import { ErrorBoundary } from "./ErrorBoundary";

const openLogsFolder = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../shared/api/bus", async (real) => ({ ...(await real<object>()), inTauri: true }));
vi.mock("../shared/lib/log", async (real) => ({ ...(await real<object>()), logError: vi.fn(), openLogsFolder }));

const Broken = (): never => {
  throw new Error("boom");
};

beforeEach(() => {
  setLang("en");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  setLang("ru");
});

describe("error screen in the app", () => {
  it("the main window offers the log folder", () => {
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open log folder" }));
    expect(openLogsFolder).toHaveBeenCalledOnce();
  });

  it("a small window keeps only the restart button", () => {
    render(
      <ErrorBoundary compact>
        <Broken />
      </ErrorBoundary>,
    );
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Restart window"]);
  });
});
