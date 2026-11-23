import { describe, expect, it } from "vitest";
import { inlineHtml, releasesOf, releasesHtml } from "./changelog.mjs";

const CHANGELOG = `# Changelog

What changed in each version, newest first.

## Unreleased

### New

- Not out yet.

## 0.13.0 — 2026-11-23

### New

- **Write to us**: Settings → Help has a form. "Copy the text" is there too.

### Changed

- **Quick add** starts the title with a capital letter.
- Text in angle brackets like "a < b > c" & \`code\` is shown as typed.

## 0.12.4 — 2026-11-19

### Fixed

- Tray agenda: a long time no longer runs into the title.

## 0.2.0 — 2026-11-08

The first public version.

- Quick add from one line.
`;

describe("released versions of the changelog", () => {
  it("lists the versions with their dates, newest first, without what is not released yet", () => {
    expect(releasesOf(CHANGELOG).map((r) => [r.version, r.date])).toEqual([
      ["0.13.0", "2026-11-23"],
      ["0.12.4", "2026-11-19"],
      ["0.2.0", "2026-11-08"],
    ]);
  });

  it("keeps the groups of a version and their items in order", () => {
    const [latest, previous, first] = releasesOf(CHANGELOG);
    expect(latest.groups.map((g) => [g.title, g.items.length])).toEqual([
      ["New", 1],
      ["Changed", 2],
    ]);
    expect(previous.groups).toEqual([
      { title: "Fixed", items: ["Tray agenda: a long time no longer runs into the title."] },
    ]);
    // a version may have a line of text and a list without a heading
    expect(first).toMatchObject({
      notes: ["The first public version."],
      groups: [{ title: "", items: ["Quick add from one line."] }],
    });
    const html = releasesHtml([first]);
    expect(html).toContain("<p>The first public version.</p>");
    expect(html).toContain("<li>Quick add from one line.</li>");
    expect(html).not.toContain("<h3>");
  });

  it("reads the same from a file with Windows line ends", () => {
    expect(releasesOf(CHANGELOG.replace(/\n/g, "\r\n"))).toEqual(releasesOf(CHANGELOG));
  });
});

describe("changelog text as HTML", () => {
  it("makes bold and code, and escapes everything else", () => {
    expect(inlineHtml('**Quick add** takes "a < b > c" & `#work`')).toBe(
      "<strong>Quick add</strong> takes &quot;a &lt; b &gt; c&quot; &amp; <code>#work</code>",
    );
  });

  it("gives every version a section with an anchor, the date in words, groups and items", () => {
    const html = releasesHtml(releasesOf(CHANGELOG));
    expect(html).toContain('<section class="release" id="v0.13.0">');
    expect(html).toContain('<h2>0.13.0 <time datetime="2026-11-23">23 November 2026</time></h2>');
    expect(html).toContain("<h3>Changed</h3>");
    expect(html).toContain("<li><strong>Quick add</strong> starts the title with a capital letter.</li>");
    expect(html.indexOf('id="v0.13.0"')).toBeLessThan(html.indexOf('id="v0.12.4"'));
    expect(html).not.toContain("Not out yet");
  });
});
