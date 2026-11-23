// Checks the built website pages (site/**/index.html): run `node scripts/build-site.mjs` after changing the site.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { releasesOf } from "./lib/changelog.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(ROOT, "site");
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

describe("website: What's new", () => {
  const page = readFileSync(join(SITE, "whats-new.html"), "utf8");
  const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
  const appVersion = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

  it("has every released version of CHANGELOG.md, newest first", () => {
    const anchors = [...page.matchAll(/<section class="release" id="v([\d.]+)">/g)].map((m) => m[1]);
    expect(anchors).toEqual(releasesOf(changelog).map((r) => r.version));
    expect(anchors.length).toBeGreaterThan(10);
  });

  it("has the section that the link in the app's Settings points to", () => {
    expect(page).toContain(`<section class="release" id="v${appVersion}">`);
  });

  it("says nothing about what is not released yet", () => {
    expect(page).not.toContain("Unreleased");
  });

  it.each(LANGS)("%s: the home page links to it from the footer", (lang) => {
    expect(home(lang)).toContain(`<a href="${lang === "en" ? "" : "../"}whats-new.html" hreflang="en">`);
  });

  it("is in the sitemap", () => {
    expect(readFileSync(join(SITE, "sitemap.xml"), "utf8")).toContain("<loc>https://calmcalendar.co.uk/whats-new.html</loc>");
  });
});
