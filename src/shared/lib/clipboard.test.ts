// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";

const execCommand = vi.fn((_command: string) => true);

afterEach(() => {
  vi.unstubAllGlobals();
  execCommand.mockReset();
  document.body.innerHTML = "";
});

const clipboard = (writeText: (text: string) => Promise<void>) => vi.stubGlobal("navigator", { clipboard: { writeText } });

describe("copying text", () => {
  it("goes through the Clipboard API", async () => {
    const writeText = vi.fn(async (_text: string) => {});
    clipboard(writeText);
    expect(await copyText("Dentist, 16:00")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("Dentist, 16:00");
  });

  it("falls back to copying a selection, and cleans up after itself", async () => {
    clipboard(async () => {
      throw new Error("denied");
    });
    let copied = "";
    document.execCommand = (command: string) => {
      const area = document.querySelector("textarea")!;
      copied = area.value.slice(area.selectionStart, area.selectionEnd);
      return execCommand(command);
    };
    execCommand.mockReturnValue(true);
    expect(await copyText("Dentist, 16:00")).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(copied).toBe("Dentist, 16:00");
    expect(document.querySelector("textarea")).toBeNull();

    execCommand.mockReturnValue(false);
    expect(await copyText("again")).toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
  });
});
