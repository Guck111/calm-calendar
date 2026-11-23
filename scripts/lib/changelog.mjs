// CHANGELOG.md as data and as HTML for the website's "What's new" page.
// The file is simple on purpose: "## version — date", a line of text, "### group", "- item" on one line,
// **bold** and `code`.

/** Released versions, newest first as in the file; "Unreleased" is left out */
export const releasesOf = (changelog) => {
  const releases = [];
  let group = null;
  for (const line of changelog.split(/\r?\n/)) {
    const version = line.match(/^## (\d+\.\d+\.\d+) — (\d{4}-\d{2}-\d{2})$/);
    if (version) {
      releases.push({ version: version[1], date: version[2], notes: [], groups: [] });
      group = null;
    } else if (line.startsWith("## ")) {
      // "Unreleased" or a heading that is not a version: what follows belongs to no release
      releases.push(null);
      group = null;
    } else if (line.startsWith("### ") && releases.at(-1)) {
      group = { title: line.slice(4).trim(), items: [] };
      releases.at(-1).groups.push(group);
    } else if (line.startsWith("- ") && releases.at(-1)) {
      // a list right under the version is a group without a title
      if (!group) releases.at(-1).groups.push((group = { title: "", items: [] }));
      group.items.push(line.slice(2).trim());
    } else if (line.trim() && !line.startsWith("#") && releases.at(-1) && !group) {
      // a plain line under the version, before any group
      releases.at(-1).notes.push(line.trim());
    }
  }
  return releases.filter(Boolean);
};

const escapeHtml = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const inlineHtml = (text) =>
  escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>");

const dateInWords = (date) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );

/** A section per version; the app links to "#v<version>" */
export const releasesHtml = (releases) =>
  releases
    .map(({ version, date, notes, groups }) =>
      [
        `<section class="release" id="v${version}">`,
        `  <h2>${version} <time datetime="${date}">${dateInWords(date)}</time></h2>`,
        ...notes.map((note) => `  <p>${inlineHtml(note)}</p>`),
        ...groups.flatMap(({ title, items }) => [
          ...(title ? [`  <h3>${escapeHtml(title)}</h3>`] : []),
          "  <ul>",
          ...items.map((item) => `    <li>${inlineHtml(item)}</li>`),
          "  </ul>",
        ]),
        "</section>",
      ].join("\n"),
    )
    .join("\n\n");
