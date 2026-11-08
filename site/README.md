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

| File | Page |
|---|---|
| `privacy-policy.md` | `privacy.html` — required by Google verification and the Microsoft Store |
| `terms-of-use.md` | `terms.html` — optional "Terms of service link" in Google Branding |
| `privacy-policy.ru.md`, `terms-of-use.ru.md` | Russian versions, if the site gets a Russian page |

Before publishing, replace `[support@calmcalendar.co.uk](mailto:support@calmcalendar.co.uk)` with the real address.

## Requirements the site must meet

Google checks the home page during OAuth verification:

- the page is public, without sign-in, and the name "Calm Calendar" matches the OAuth consent screen;
- it explains what the app does and why it asks for Google Calendar access;
- it links to the privacy policy, which lives on the same domain;
- the domain is verified in Google Search Console by the account that owns the Google Cloud project. A shared domain such as `github.io` is often rejected, so connect a domain of your own.
