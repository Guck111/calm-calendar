// Checks the built website pages (site/**/index.html): run `node scripts/build-site.mjs` after changing the site.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..", "site");
const STORE_URL = "https://apps.microsoft.com/detail/9N5HZ8P1QRMW";
const LANGS = ["en", "es", "pt", "fr", "de", "ru", "uk", "be", "zh", "ja", "hi", "bn", "ar"];

const home = (lang) => readFileSync(join(SITE, lang === "en" ? "" : lang, "index.html"), "utf8");
const app = (html) =>
  JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]).find(
    (item) => item["@type"] === "SoftwareApplication",
  );

describe("website home page", () => {
  it.each(LANGS)("%s: the structured data names the Store page as the place to install", (lang) => {
    expect(app(home(lang)).installUrl).toBe(STORE_URL);
  });

  it.each(LANGS)("%s: the Store button leads to the same Store page", (lang) => {
    expect(home(lang)).toContain(`<a class="btn btn-primary" href="${STORE_URL}?cid=website">`);
  });

  it("the installers on GitHub stay as the download link", () => {
    expect(app(home("en")).downloadUrl).toBe("https://github.com/Guck111/calm-calendar/releases/latest");
  });
});
