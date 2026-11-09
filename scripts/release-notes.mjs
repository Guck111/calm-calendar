// Section of CHANGELOG.md for one version, for the GitHub release page.
// node scripts/release-notes.mjs 0.5.0 > notes.md
import { readFileSync } from "node:fs";

export const notesFor = (changelog, version) => {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(`## ${version} `) || l === `## ${version}`);
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join("\n")
    .trim();
};

if (process.argv[1]?.endsWith("release-notes.mjs")) {
  const version = (process.argv[2] ?? "").replace(/^v/, "");
  const notes = notesFor(readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"), version);
  if (!notes) {
    console.error(`CHANGELOG.md has no section for ${version}`);
    process.exit(1);
  }
  console.log(notes);
}
