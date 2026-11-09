# To do

## Website and SEO

- Say on calmcalendar.co.uk that the app speaks 11 languages where people look: today it is one sentence in the "Quick add" card. Ideas: a line or card with the language names written in each language, the languages in `<meta name="description">` and the page title.
- Structured data (`SoftwareApplication` JSON-LD) with `inLanguage`, `operatingSystem`, `offers` (free), link to the Store once it is published.
- Later: landing pages in the biggest new languages (Spanish, Portuguese, German, Hindi) with `hreflang`.

## Design

- [ ] Rework the app's styles (asked for on 2026-11-09; scope to agree first: main window, event card, widget, settings, light and dark themes).

## Features (plan from the user-pain research, 2026-11-08)

Stage 1 — never miss a meeting (no new Google scopes):

- [x] "Join" button for Meet, Zoom and Teams links: event card, widget, Windows notification.
- [x] Hard-to-miss reminder (opt-in): a calm window over everything at the start of a meeting with Join, Snooze 5 min and Dismiss.
- [x] Agenda for today and tomorrow on a left click of the tray icon (Windows 11 removed it from the clock).

Stage 2 — replace the web version (no new Google scopes):

- [ ] Create and edit recurring events ("this event" / "this and following").
- [ ] Several Google accounts in one window, overlaps highlighted.
- [ ] Second time zone in the week view, time zone in the event form.
- [ ] Agenda view, week numbers, holidays (check whether public holiday calendars work with the current scopes).
- [ ] "Copy free slots" as text for a messenger.

Stage 3 — needs new Google scopes, so a new verification; do them together:

- [ ] Google Tasks in the sidebar, drag a task into the calendar.
- [ ] Outlook calendars; read-only `.ics` subscriptions need no Google scope and can come earlier.

## Languages

- [ ] Native speakers review the translations (Japanese, Hindi, Arabic and Bengali first).
