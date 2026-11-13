// Builds the website in every language:
// - home page from site/templates/index.html + site/i18n/<lang>.json
// - Privacy Policy and Terms of Use from site/templates/doc.html + site/i18n/docs/<doc>.<lang>.html
// English goes to site/*.html, other languages to site/<lang>/*.html; plus site/sitemap.xml with hreflang alternates.
// Run after editing a template, i18n/*.json or i18n/docs/*: node scripts/build-site.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(ROOT, "site");
const BASE_URL = "https://calmcalendar.co.uk";
const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const TODAY = new Date().toISOString().slice(0, 10);

// name: own-script name for the switcher; hreflang: code for search engines; locale: og:locale
const LANGS = {
  en: { name: "English", hreflang: "en", locale: "en_GB" },
  es: { name: "Español", hreflang: "es", locale: "es_ES" },
  pt: { name: "Português", hreflang: "pt", locale: "pt_BR" },
  fr: { name: "Français", hreflang: "fr", locale: "fr_FR" },
  de: { name: "Deutsch", hreflang: "de", locale: "de_DE" },
  ru: { name: "Русский", hreflang: "ru", locale: "ru_RU" },
  uk: { name: "Українська", hreflang: "uk", locale: "uk_UA" },
  be: { name: "Беларуская", hreflang: "be", locale: "be_BY" },
  zh: { name: "中文（简体）", hreflang: "zh-Hans", locale: "zh_CN" },
  ja: { name: "日本語", hreflang: "ja", locale: "ja_JP" },
  hi: { name: "हिन्दी", hreflang: "hi", locale: "hi_IN" },
  bn: { name: "বাংলা", hreflang: "bn", locale: "bn_BD" },
  ar: { name: "العربية", hreflang: "ar", locale: "ar_AR", rtl: true },
};
const CODES = Object.keys(LANGS);
const DOCS = ["privacy", "terms"];

const homeTemplate = readFileSync(join(SITE, "templates", "index.html"), "utf8");
const docTemplate = readFileSync(join(SITE, "templates", "doc.html"), "utf8");
const read = (lang) => JSON.parse(readFileSync(join(SITE, "i18n", `${lang}.json`), "utf8"));
const en = read("en");
const problems = [];

// file: "" for the home page, "privacy.html" or "terms.html" for the documents
const dir = (lang) => (lang === "en" ? "" : `${lang}/`);
const outPath = (lang, file = "") => dir(lang) + (file || "index.html");
const pageUrl = (lang, file = "") => `${BASE_URL}/${dir(lang)}${file}`;
// relative link from a page in language `from` to the same page in language `to`
const rel = (from, to, file = "") => (from === "en" ? "" : "../") + dir(to) + file || "./";

const hreflangLinks = (file) =>
  CODES.map((l) => `  <link rel="alternate" hreflang="${LANGS[l].hreflang}" href="${pageUrl(l, file)}">`)
    .concat(`  <link rel="alternate" hreflang="x-default" href="${pageUrl("en", file)}">`)
    .join("\n");

const langSwitch = (current, file) =>
  CODES.map((l) => {
    const cur = l === current ? ' aria-current="page"' : "";
    const rtl = LANGS[l].rtl ? ' dir="rtl"' : "";
    return `          <li><a href="${rel(current, l, file)}" lang="${LANGS[l].hreflang}" hreflang="${LANGS[l].hreflang}"${rtl}${cur}>${LANGS[l].name}</a></li>`;
  }).join("\n");

// On the English home page only: offer the visitor's browser language without redirecting (redirects hurt indexing).
const langSuggest = () => {
  const offers = Object.fromEntries(CODES.filter((l) => l !== "en").map((l) => [l, { href: `${l}/`, text: read(l).lang_suggest, close: read(l).lang_suggest_close, rtl: !!LANGS[l].rtl }]));
  return `  <div class="lang-suggest" id="lang-suggest" hidden><a></a><button type="button">×</button></div>
  <script>
  (function () {
    var offers = ${JSON.stringify(offers)};
    try { if (localStorage.getItem("lang-suggest-closed")) return; } catch (e) {}
    var langs = navigator.languages || [navigator.language || ""];
    for (var i = 0; i < langs.length; i++) {
      var code = String(langs[i]).toLowerCase().split("-")[0];
      if (code === "en") return;
      var o = offers[code];
      if (!o) continue;
      var bar = document.getElementById("lang-suggest"), a = bar.querySelector("a"), b = bar.querySelector("button");
      a.href = o.href; a.textContent = o.text; a.lang = code; if (o.rtl) bar.dir = "rtl";
      b.setAttribute("aria-label", o.close);
      b.onclick = function () { bar.hidden = true; try { localStorage.setItem("lang-suggest-closed", "1"); } catch (e) {} };
      bar.hidden = false;
      return;
    }
  })();
  </script>`;
};

const strip = (html) => html.replace(/<[^>]+>/g, "");
const jsonLd = (lang, s) => {
  const faq = [1, 2, 3, 4, 5].map((n) => [s[`faq_q_${n}`], s[`faq_a_${n}`]]);
  faq.push([s.faq_q_6, `${s.faq_a_6_pre} myaccount.google.com/permissions${s.faq_a_6_post}`]);
  const data = [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Calm Calendar",
      description: s.meta_description,
      url: pageUrl(lang),
      inLanguage: LANGS[lang].hreflang,
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Calendar",
      operatingSystem: "Windows 10, Windows 11",
      softwareVersion: VERSION,
      availableLanguage: CODES.map((l) => LANGS[l].hreflang),
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      downloadUrl: "https://github.com/Guck111/calm-calendar/releases/latest",
      image: `${BASE_URL}/icon-512.png`,
      screenshot: ["week", "month", "quick-add", "widget"].map((n) => `${BASE_URL}/screenshot-${n}.png`),
      featureList: Array.from({ length: 10 }, (_, i) => s[`feature_h_${i + 1}`]),
      author: { "@type": "Person", name: "Arseni" },
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      inLanguage: LANGS[lang].hreflang,
      mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: strip(q), acceptedAnswer: { "@type": "Answer", text: strip(a) } })),
    },
  ];
  // "<" escaped so text can never close the script element
  return JSON.stringify(data, null, 2).replace(/</g, "\\u003c").replace(/^/gm, "  ");
};

// fills the slots every page shares, checks nothing is left unresolved, writes the file
const write = (html, lang, s, file = "") => {
  const info = LANGS[lang];
  html = html
    .replaceAll("{{HTML_LANG}}", info.hreflang)
    .replaceAll("{{HTML_DIR}}", info.rtl ? "rtl" : "ltr")
    .replaceAll("{{CANONICAL}}", pageUrl(lang, file))
    .replaceAll("{{OG_LOCALE}}", info.locale)
    .replaceAll("{{ROOT}}", lang === "en" ? "" : "../")
    .replaceAll("{{SELF_HOME}}", "./")
    .replaceAll("{{HREFLANG_LINKS}}", hreflangLinks(file))
    .replaceAll("{{LANG_SWITCH_LINKS}}", langSwitch(lang, file));
  for (const [key, value] of Object.entries(s)) html = html.replaceAll(`{{${key}}}`, value);
  html = html.replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, "\n\n"); // collapse blank lines left by empty slots

  const leftover = html.match(/\{\{[a-zA-Z0-9_]+\}\}/g);
  if (leftover) problems.push(`${outPath(lang, file)}: unresolved ${[...new Set(leftover)].join(", ")}`);

  mkdirSync(dirname(join(SITE, outPath(lang, file))), { recursive: true });
  writeFileSync(join(SITE, outPath(lang, file)), html);
  console.log("wrote site/" + outPath(lang, file));
};

const docDates = {};
for (const lang of CODES) {
  const s = read(lang);
  for (const key of Object.keys(en)) if (!(key in s)) problems.push(`${lang}.json: missing "${key}"`);
  for (const key of Object.keys(s)) if (!(key in en)) problems.push(`${lang}.json: unknown "${key}"`);

  write(
    homeTemplate
      .replaceAll("{{LANG_SUGGEST}}", lang === "en" ? langSuggest() : "")
      .replaceAll("{{JSON_LD}}", jsonLd(lang, s)),
    lang, s);

  for (const doc of DOCS) {
    const file = `${doc}.html`;
    const body = readFileSync(join(SITE, "i18n", "docs", `${doc}.${lang}.html`), "utf8").trimEnd();
    // translations must carry the same effective date as the English original
    const date = body.match(/<time datetime="([\d-]+)"/)?.[1];
    if (!date) problems.push(`docs/${doc}.${lang}.html: no <time datetime>`);
    else if (lang === "en") docDates[doc] = date;
    else if (date !== docDates[doc]) problems.push(`docs/${doc}.${lang}.html: date ${date}, English has ${docDates[doc]}`);
    write(
      docTemplate
        .replaceAll("{{DOC_TITLE}}", s[`${doc}_title`])
        .replaceAll("{{DOC_DESCRIPTION}}", s[`${doc}_description`])
        .replaceAll("{{CURRENT_privacy}}", doc === "privacy" ? ' aria-current="page"' : "")
        .replaceAll("{{CURRENT_terms}}", doc === "terms" ? ' aria-current="page"' : "")
        .replaceAll("{{DOC_BODY}}", body.replace(/^(?=.)/gm, "      ")),
      lang, s, file);
  }
}

// sitemap: every language version of a page lists all its alternates
const sitemapEntries = (file, lastmod) => {
  const alternates = CODES.map((l) => `    <xhtml:link rel="alternate" hreflang="${LANGS[l].hreflang}" href="${pageUrl(l, file)}"/>`)
    .concat(`    <xhtml:link rel="alternate" hreflang="x-default" href="${pageUrl("en", file)}"/>`)
    .join("\n");
  return CODES.map((l) => `  <url>\n    <loc>${pageUrl(l, file)}</loc>\n    <lastmod>${lastmod}</lastmod>\n${alternates}\n  </url>`).join("\n");
};
writeFileSync(join(SITE, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${[sitemapEntries("", TODAY), ...DOCS.map((d) => sitemapEntries(`${d}.html`, docDates[d]))].join("\n")}
</urlset>
`);
console.log("wrote site/sitemap.xml");

if (problems.length) {
  console.error("\nProblems:\n" + problems.join("\n"));
  process.exit(1);
}
