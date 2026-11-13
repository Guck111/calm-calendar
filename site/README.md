# Website

Everything the Calm Calendar website needs, ready to hand to a designer or to Claude Design.

## Images

| File | Size | Use |
|---|---|---|
| `screenshot-week.png` | 2880×1800 | Hero screenshot: week view, light theme |
| `screenshot-week-dark.png` | 2880×1800 | Same in dark theme (for `prefers-color-scheme: dark`) |
| `screenshot-quick-add.png` | 2880×1800 | Quick add with its preview |
| `screenshot-month.png` | 2880×1800 | Month view |
| `screenshot-widget.png` | 600×1202, transparent corners | Desktop widget, light |
| `screenshot-widget-dark.png` | 600×1202, transparent corners | Desktop widget, dark |
| `icon.png` | 256×256 | Logo in the header and hero |
| `icon-512.png` | 512×512 | Open Graph image, large logo |
| `apple-touch-icon.png` | 180×180 | `<link rel="apple-touch-icon">` |
| `favicon.ico`, `favicon-32.png` | 16–256, 32×32 | Favicon |

Screenshots are taken at 2× from the real interface with English sample data (no real accounts), with the clock set to Wednesday 9:50 AM of the current week. To retake them, run `npm run dev` and then `node scripts/screenshots.mjs site`.

## Texts

The pages are built from HTML fragments in `i18n/docs/` (see Languages below); the Markdown files are older drafts kept for reference and are not used by the site.

| Source | Page |
|---|---|
| `i18n/docs/privacy.<lang>.html` | `privacy.html`, `<lang>/privacy.html` — required by Google verification and the Microsoft Store |
| `i18n/docs/terms.<lang>.html` | `terms.html`, `<lang>/terms.html` — optional "Terms of service link" in Google Branding |

The English versions are authoritative: every translation says so at the top, with a link to the English page. `/privacy.html` and `/terms.html` must keep their addresses, because they are registered with Google OAuth and the Microsoft Store.

## Requirements the site must meet

Google checks the home page during OAuth verification:

- the page is public, without sign-in, and the name "Calm Calendar" matches the OAuth consent screen;
- it explains what the app does and why it asks for Google Calendar access;
- it links to the privacy policy, which lives on the same domain;
- the domain is verified in Google Search Console by the account that owns the Google Cloud project. A shared domain such as `github.io` is often rejected, so connect a domain of your own.

## Languages

Every page exists in all 13 app languages: English at the root (`index.html`, `privacy.html`, `terms.html`, also `x-default`) and the others in `<lang>/` (`/ru/`, `/ru/privacy.html`, …). Do not edit these files by hand: they are generated.

- Home page: layout `templates/index.html`, texts `i18n/<lang>.json` (same keys in every file).
- Privacy Policy and Terms of Use: layout `templates/doc.html` (header, footer, SEO tags), body `i18n/docs/<doc>.<lang>.html`. Section ids and links must match the English file; the effective date in `<time datetime>` must be the same in every language.
- After any change run `node scripts/build-site.mjs`: it writes all pages and `sitemap.xml`, and fails if a key is missing or a translation's date differs from the English one.
- When the English policy or terms change, update all 13 fragments and the date in each.
- Each page gets its own title and description, `canonical`, `hreflang` links to every version, and `og:locale`; the home page also gets JSON-LD (`SoftwareApplication` + `FAQPage`) in its language. The sitemap lists every version with its alternates.
- The English home page shows a small link to the visitor's browser language when a translation exists; there is no automatic redirect, so search engines index every version.
- A new language: add it to `LANGS` in `scripts/build-site.mjs`, add `i18n/<lang>.json` and `i18n/docs/{privacy,terms}.<lang>.html`, and add the folder to the copy loop in `.github/workflows/pages.yml`.
