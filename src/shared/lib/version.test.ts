import { describe, expect, it } from "vitest";
import tauriConfig from "../../../src-tauri/tauri.conf.json";
import cargoToml from "../../../src-tauri/Cargo.toml?raw";
import { APP_VERSION } from "./version";

describe("app version shown in Settings", () => {
  it("is a release number", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("is the version the installer and the Store package are built with", () => {
    expect(tauriConfig.version).toBe(APP_VERSION);
    expect(cargoToml).toMatch(new RegExp(`^version = "${APP_VERSION.replace(/\./g, "\\.")}"$`, "m"));
  });
});
