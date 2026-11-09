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
- [x] "Sign out" next to an account in the sidebar asks first: the first click turns it into a red "Sign out?", the second signs out; it goes back after 5 seconds, on Escape or when focus leaves. Checked in the app on 2026-11-09 (first click and Escape only, no real sign-out).
- [x] One meeting that both accounts are invited to (same iCalUID and start) is shown once: the copy in a calendar you can edit stays, the card says "Also in: <other account>". Copies inside one account stay separate, as in Google. Checked with tests and mock data only: the real accounts have no shared meeting this week.
- [x] Second time zone in the week view, time zone in the event form: Settings switch and zone list for an extra hour column in Week and Day; a Time zone field in the form, times in the form follow the event's zone, a "your time" hint when it is not the system zone, the zone in the event card. An event keeps its Google zone (start.timeZone, else the calendar's) when edited, dragged, or edited as "this and following"; a different end zone is kept until the zone is changed; UNTIL and weekdays of a rule are counted in the event's zone. Checked in the browser with mock data (Russian, Arabic RTL, India +5:30). Checked in the app against a real Google account on 2026-11-09: a New York event created from the form, dragged and edited keeps `America/New_York` in Google; the card and the "your time" hint are right; the UTC column appears and goes away. Recurring events in another zone were checked with tests only.
- [x] Schedule view, week numbers, holidays. Schedule (key A): four weeks from the chosen day as a list, days without events skipped. Week numbers (ISO 8601, a Settings switch): in the mini calendar, the Month view and next to the week title. Holidays (Settings): a country's public Google holiday calendar (76 countries, ids checked, names in the app language) read with the current calendar.events scope and shown as a separate "Holidays" group; it is not added to the Google calendar list (that needs a new scope) and is skipped when the same country is already there. Checked in the app with the real account on 2026-11-09: Ukrainian holidays load; schedule, week numbers. The desktop widget and the tray agenda show the same holidays and reload when the country changes; checked in the app on 2026-11-10 with US holidays ("Veterans Day" tomorrow in the widget, gone after "Don't show").
- [x] "Free time" (clock button in the toolbar): gaps between busy events in working hours for the days on screen from now on, minimum length, weekends on or off, preview and Copy. All-day and "free" events don't count. Checked in the app on 2026-11-09: the text is right and Copy works.
- [x] Travel time: a "Travel time" field in the form (none, 5 min to 2 h), stored in the event's private extended properties (`calmTravelMinutes`, allowed by the calendar.events scope; Google's own apps ignore it, a new series from "this and following" keeps the other private fields). A hatched "On the way" strip above the event in Week and Day; the card shows it; it counts as busy in "Free time" and in overlaps between accounts. Only the way there, like Apple Calendar. Checked in the app with the real account on 2026-11-09: saved, read back from Google, deleted.
- [x] Guests in the event form: add by email (Enter, comma, or leaving the field; a wrong address is refused), remove, each guest's answer and the organizer; the card lists guests, declined ones crossed out. Only the organizer can change the list: for someone else's meeting it is not sent back. With guests Google emails them about a new meeting, changes and cancellation (`sendUpdates=all`). Checked with tests and mock data; checked by the user with real accounts on 2026-11-10.

Stage 3 — needs new Google scopes, so a new verification; do them together:

- [ ] Google Tasks in the sidebar, drag a task into the calendar.
- [ ] Outlook calendars; read-only `.ics` subscriptions need no Google scope and can come earlier.

## Ideas for later

- Location with Google Maps (asked for on 2026-11-09, moved out of stage 2 on 2026-11-10; the feature still needs thinking through): suggestions from Google Maps while typing in the "Location" field, a small map of the place in the event card, a click on the map opens the place in Google Maps. To decide: Places API needs an API key with billing (not an OAuth scope, so no new Google verification) and a way to keep the key out of the app or behind a proxy, or a free alternative (OpenStreetMap Nominatim, a static map image); what is shown offline; the privacy policy has to mention the maps service. Prices on 2026-11-09: Places autocomplete sessions are free when they end in a Place Details call; 10,000 free requests a month per Essentials SKU, then about $2.83 per 1,000 autocomplete requests. A free first step: open the location in Google Maps on a click (no key).

## Testing

- [ ] End-to-end tests of the real app (asked for on 2026-11-09). Today only unit tests run; the windows, tray, notifications and alerts were checked by hand. Candidates: tauri-driver with WebdriverIO on Windows for the main window, widget, alert and tray agenda (debug hooks `CALM_DEMO_ALERT` and `CALM_DEMO_AGENDA` already open the last two); Playwright against `npm run dev` with mock data for the UI flows (quick add in every language, event card, settings, right-to-left Arabic). Run them in CI on a Windows runner.

## Languages

- [ ] Native speakers review the translations (Japanese, Hindi, Arabic and Bengali first).
