// Builds the home page in every language from site/templates/index.html + site/i18n/<lang>.json:
// site/index.html (English) and site/<lang>/index.html, plus site/sitemap.xml with hreflang alternates.
// Run after editing the template or any i18n/*.json: node scripts/build-site.mjs
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

const template = readFileSync(join(SITE, "templates", "index.html"), "utf8");
const read = (lang) => JSON.parse(readFileSync(join(SITE, "i18n", `${lang}.json`), "utf8"));
const en = read("en");

const outPath = (lang) => (lang === "en" ? "index.html" : `${lang}/index.html`);
const pageUrl = (lang) => (lang === "en" ? `${BASE_URL}/` : `${BASE_URL}/${lang}/`);
// relative link from the page in `from` to the page in `to`
const relHome = (from, to) => (from === "en" ? (to === "en" ? "./" : `${to}/`) : to === "en" ? "../" : `../${to}/`);

const hreflangLinks = CODES.map((l) => `  <link rel="alternate" hreflang="${LANGS[l].hreflang}" href="${pageUrl(l)}">`)
  .concat(`  <link rel="alternate" hreflang="x-default" href="${pageUrl("en")}">`)
  .join("\n");

const langSwitch = (current) =>
  CODES.map((l) => {
    const cur = l === current ? ' aria-current="page"' : "";
    const dir = LANGS[l].rtl ? ' dir="rtl"' : "";
    return `          <li><a href="${relHome(current, l)}" lang="${LANGS[l].hreflang}" hreflang="${LANGS[l].hreflang}"${dir}${cur}>${LANGS[l].name}</a></li>`;
  }).join("\n");

// On the English page only: offer the visitor's browser language without redirecting (redirects hurt indexing).
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

const problems = [];
for (const lang of CODES) {
  const s = read(lang);
  for (const key of Object.keys(en)) if (!(key in s)) problems.push(`${lang}.json: missing "${key}"`);
  for (const key of Object.keys(s)) if (!(key in en)) problems.push(`${lang}.json: unknown "${key}"`);

  const info = LANGS[lang];
  const root = lang === "en" ? "" : "../";
  let html = template
    .replaceAll("{{HTML_LANG}}", info.hreflang)
    .replaceAll("{{HTML_DIR}}", info.rtl ? "rtl" : "ltr")
    .replaceAll("{{CANONICAL}}", pageUrl(lang))
    .replaceAll("{{OG_LOCALE}}", info.locale)
    .replaceAll("{{ROOT}}", root)
    .replaceAll("{{SELF_HOME}}", "./")
    .replaceAll("{{HREFLANG_LINKS}}", hreflangLinks)
    .replaceAll("{{LANG_SWITCH_LINKS}}", langSwitch(lang))
    .replaceAll("{{LANG_SUGGEST}}", lang === "en" ? langSuggest() : "")
    .replaceAll("{{JSON_LD}}", jsonLd(lang, s))
    .replaceAll("{{EN_ONLY_SUFFIX}}", lang === "en" ? "" : s.footer_en_only);

  for (const [key, value] of Object.entries(s)) html = html.replaceAll(`{{${key}}}`, value);
  html = html.replace(/^\n/gm, (m, off) => (html[off - 1] === "\n" ? "" : m)); // drop blank lines left by empty slots

  const leftover = html.match(/\{\{[a-zA-Z0-9_]+\}\}/g);
  if (leftover) problems.push(`${lang}: unresolved ${[...new Set(leftover)].join(", ")}`);

  mkdirSync(dirname(join(SITE, outPath(lang))), { recursive: true });
  writeFileSync(join(SITE, outPath(lang)), html);
  console.log("wrote site/" + outPath(lang));
}

// sitemap: every language version lists all its alternates
const alternates = CODES.map((l) => `    <xhtml:link rel="alternate" hreflang="${LANGS[l].hreflang}" href="${pageUrl(l)}"/>`)
  .concat(`    <xhtml:link rel="alternate" hreflang="x-default" href="${pageUrl("en")}"/>`)
  .join("\n");
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${CODES.map((l) => `  <url>\n    <loc>${pageUrl(l)}</loc>\n    <lastmod>${TODAY}</lastmod>\n${alternates}\n  </url>`).join("\n")}
  <url>
    <loc>${BASE_URL}/privacy.html</loc>
    <lastmod>2026-11-11</lastmod>
  </url>
  <url>
    <loc>${BASE_URL}/terms.html</loc>
    <lastmod>2026-11-08</lastmod>
  </url>
</urlset>
`;
writeFileSync(join(SITE, "sitemap.xml"), sitemap);
console.log("wrote site/sitemap.xml");

if (problems.length) {
  console.error("\nProblems:\n" + problems.join("\n"));
  process.exit(1);
}
