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

- [x] Create and edit recurring events ("this event" / "this and following"): a Repeat field with presets and a custom rule (interval, weekdays, "2nd Tuesday", end by date or count); saving or deleting an occurrence asks "this event" or "this and following"; "this and following" from the first occurrence changes the whole series, from the middle it splits the series (the new one keeps guests, Meet link and reminders). Checked in the app against a real Google account on 2026-11-09: create with a count, split from the middle, "this event" edit and delete, delete a whole series.
- [x] Several Google accounts in one window, overlaps highlighted: one refresh token per account, calendars grouped by account in the sidebar with "Sign out" and "Add account", timed events overlapping an event of another account get a red edge and a note in the card (the same meeting in both accounts and "free" events don't count). The 0.4 sign-in is copied over on first start. Checked in the app on 2026-11-09 with two real accounts: migration, second sign-in, an event in the second account, overlap marks. Signing out of one account was checked with mock data only (it revokes the token).
- [ ] Later: show one meeting that both accounts are invited to once instead of twice (same iCalUID).
- [ ] Second time zone in the week view, time zone in the event form. Done in the code on 2026-11-09 (branch feature/time-zones): Settings switch and zone list for an extra hour column in Week and Day; a Time zone field in the form, times in the form follow the event's zone, a "your time" hint when it is not the system zone, the zone in the event card. An event keeps its Google zone (start.timeZone, else the calendar's) when edited, dragged, or edited as "this and following"; a different end zone is kept until the zone is changed; UNTIL and weekdays of a rule are counted in the event's zone. Checked in the browser with mock data (Russian, Arabic RTL, India +5:30); still to check in the app with a real account.
- [ ] Agenda view, week numbers, holidays (check whether public holiday calendars work with the current scopes). Seen on 2026-11-09: a holiday calendar the user already added in Google ("Holidays in Poland") loads and shows; adding a new one from the app is still to check.
- [ ] "Copy free slots" as text for a messenger.

Stage 3 — needs new Google scopes, so a new verification; do them together:

- [ ] Google Tasks in the sidebar, drag a task into the calendar.
- [ ] Outlook calendars; read-only `.ics` subscriptions need no Google scope and can come earlier.

## Testing

- [ ] End-to-end tests of the real app (asked for on 2026-11-09). Today only unit tests run; the windows, tray, notifications and alerts were checked by hand. Candidates: tauri-driver with WebdriverIO on Windows for the main window, widget, alert and tray agenda (debug hooks `CALM_DEMO_ALERT` and `CALM_DEMO_AGENDA` already open the last two); Playwright against `npm run dev` with mock data for the UI flows (quick add in every language, event card, settings, right-to-left Arabic). Run them in CI on a Windows runner.

## Languages

- [ ] Native speakers review the translations (Japanese, Hindi, Arabic and Bengali first).
