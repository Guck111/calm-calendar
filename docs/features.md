# Calm Calendar features

Everything the app can do today, by area. Keep this file up to date with every feature: it is the reference for the README, the Store listing, the website and the release notes. Code paths point to where each feature lives.

Last updated: 2026-11-10 (version 0.8.0 and unreleased styles and fonts).

## Contents

- [Google accounts and sign-in](#google-accounts-and-sign-in)
- [Views](#views)
- [Events](#events)
- [Recurring events](#recurring-events)
- [Time zones](#time-zones)
- [Guests and shared meetings](#guests-and-shared-meetings)
- [Travel time](#travel-time)
- [Free time](#free-time)
- [Holidays and week numbers](#holidays-and-week-numbers)
- [Quick add](#quick-add)
- [Search](#search)
- [Video calls](#video-calls)
- [Reminders and the hard-to-miss alert](#reminders-and-the-hard-to-miss-alert)
- [Desktop widget](#desktop-widget)
- [Tray](#tray)
- [Look and feel](#look-and-feel)
- [Languages and regions](#languages-and-regions)
- [Offline](#offline)
- [Settings](#settings)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Errors and the log](#errors-and-the-log)
- [Privacy and permissions](#privacy-and-permissions)
- [Installation and updates](#installation-and-updates)
- [Not there yet](#not-there-yet)
- [Tests](#tests)

## Google accounts and sign-in

- Sign-in happens in the system browser with OAuth and PKCE; the app never sees the Google password (`src-tauri/src/oauth.rs`).
- Several Google accounts in one window: "Add account" at the bottom of the sidebar. Calendars are grouped by account, each group has "Sign out".
- "Sign out" asks a second time ("Sign out?" in red); it goes back after 5 seconds, on Esc or when focus leaves. Signing out revokes the token at Google.
- If Google stops accepting an account's sign-in, its group says so with "Sign in again"; the other accounts keep working.
- Overlaps between accounts: a timed event that overlaps an event of another account gets a red edge, a warning sign and a note in its card ("Overlaps with: …"). All-day events, events marked "free" and the same meeting in both accounts don't count. Travel time counts.
- Tokens are kept per account by the Rust side; the sign-in of version 0.4 is moved over on the first start.

## Views

- **Day** and **Week**: hours grid with a line for the current time, all-day events in a strip at the top. Opens at 7:00, or near the current hour when today is on screen in the evening.
- **Month**: six weeks, up to four events per day and "N more".
- **Schedule**: four weeks from the chosen day as a list by day; days without events are skipped. Each row: time or "all day", title, repeat and overlap marks, location.
- Mini month in the sidebar: picks a day, shows the range on screen, has its own month arrows.
- Toolbar: Today, back and forward, the period title (with the week number when week numbers are on), search, free time, theme, refresh, settings, view switch.
- Calendars can be shown or hidden one by one; colors come from Google. The choice is remembered in the app.
- Data refreshes every 5 minutes, when the window comes back to the front, and with the refresh button. The bottom of the sidebar says when the calendar was last loaded from Google ("Updated 10:42"; with the date if it was not today).
- When Google does not answer (no network, Google busy or down: 429 and 5xx), the app tries again by itself after 5 seconds, 15 seconds and a minute, then goes on with the usual refresh. The error or "Offline" banner has a Retry button (`src/model/sync.ts`).

## Events

- Create: the "Create" button, a click on an empty slot (Week, Day: that half hour; Month: 9:00 that day), quick add, or the widget.
- The event card shows the time, the time in the event's own zone if it differs, Join for calls, the calendar (and account when there are several), travel time, location, guests with their answers, description, overlaps, the repeat rule, and "In Google".
- The form: title, all day, start and end date and time, time zone, travel time, repeat, calendar, color, location, "Add Google Meet video call", guests, attachments, description.
- Move an event to another calendar of the same account (Google does not move events between accounts).
- Delete asks once ("Delete?").
- Attachments: the card lists the Google Drive files attached to the event, a click opens one in the browser. In the form a Drive file is attached by pasting its link (Docs, Sheets, Slides, Forms or a Drive file; other links are refused), and removed with ×; up to 25. Attachments go to Google only when the list was changed, so editing and dragging keep them, and "this and following" passes them to the new series. Uploading a file from the computer needs a Google Drive permission (stage 3b) (`src/shared/lib/attachments.ts`).
- Color of a single event: the calendar color or one of Google's 11 event colors (Lavender … Tomato), as on the Google Calendar website. Shown in every view, the card, the widget and the tray agenda; stored in Google (`colorId`), so the website and phones show it too (`src/shared/lib/colors.ts`).
- "Duplicate" in the card opens the form of a new event with the same title, time, time zone, location, description, travel time and guests. An occurrence of a series is copied as one event; the old video call and the guests' answers are not copied. An event from a read-only calendar (holidays, someone else's calendar) is copied into your first calendar.
- Week and Day: drag an event to another time or day, drag its bottom edge to change the length; 30-minute snap on click, 15-minute step when dragging, Esc cancels. The change is saved at once and keeps the event's time zone.
- Read-only calendars (holidays, other people's calendars) open in the card only.

## Recurring events

- Repeat field with presets (every day, weekdays, every week on this day, every month, every year) and a custom rule: interval, weekdays, "2nd Tuesday" or "on the 14th", end never, on a date or after a number of times (`src/ui/RepeatField.tsx`, `src/shared/lib/rrule.ts`).
- Saving or deleting one occurrence asks "This event" or "This and following".
- "This and following" from the first occurrence changes the whole series; from the middle it splits the series: the old one ends before this occurrence, the new one keeps guests, the Meet link, reminders and the app's own fields.
- Weekdays and the end date of a rule are counted in the event's time zone.

## Time zones

- The event form has a time zone field; the times in the form are the clock time in that zone, with "Your time: …" below when it is not the system zone.
- An event keeps its Google time zone when it is edited, dragged or edited as "this and following". A different end zone (a flight) is kept until the zone is changed in the form.
- Second time zone (Settings): an extra hour column in Week and Day with the zone's short name on top; half-hour zones show ":30".
- Zone names and offsets come from the system (`Intl`), no time zone library (`src/shared/lib/tz.ts`).

## Guests and shared meetings

- Guests field in the form: add by email with Enter or a comma, a wrong address is refused, remove with ×. Each guest shows the answer: going, not going, maybe, no reply yet; the organizer is marked.
- Google emails the guests about the new meeting, its changes and its cancellation, as on the Google Calendar website.
- Answer an invitation in its card: "Going? Yes · No · Maybe", shown for someone else's meeting that this account is invited to. Only your own answer goes to Google (`attendeesOmitted`), the organizer gets Google's email; in a series the answer is for that occurrence.
- Only the organizer can change the guest list; for someone else's meeting the field is hidden and the list is left alone.
- A meeting that two of your accounts are invited to is shown once; its card says "Also in: <other account>". The copy you can edit is the one shown.

## Travel time

- "Travel time" in the form: none, 5, 10, 15, 30, 45 minutes, 1, 1.5 or 2 hours.
- Shown as a hatched "On the way" strip before the event in Week and Day, and in the card.
- Counts as busy in Free time and in overlaps between accounts.
- Google Calendar has no such field, so it is stored in the event's private fields in Google: it follows the event to every computer with Calm Calendar, but Google's own apps don't show it.

## Free time

- Clock button in the toolbar: the gaps between events in working hours for the days on screen, from now on, as text for a messenger:
  "When I'm free (Warsaw, GMT+1): Tue, November 10: 11:00–12:00 and 15:00–18:00".
- Working hours, the shortest gap (15 minutes to 2 hours) and weekends on or off; the weekend follows the region (Friday and Saturday in Saudi Arabia).
- All-day events and events marked "free" don't block time; travel time does.
- Copy puts the text on the clipboard. The options are remembered.

## Holidays and week numbers

- Holidays (Settings): the public holidays of one of 76 countries, from Google's public holiday calendars, with names in the app language when Google has them. Shown as a separate "Holidays" group in the sidebar, in the widget and in the tray agenda. Kept only in the app: adding a calendar to the Google calendar list would need another Google permission. If the same country's holidays are already in your Google calendars, they are not shown twice.
- Week numbers (Settings): ISO 8601 numbers in the mini month, in the Month view and next to the week title.

## Quick add

A field under the "Create" button and in the widget; `N` focuses it. One line, a live preview of how it was understood (its hint says "Enter or click to add"); Enter or a click on the preview creates, Ctrl+Enter (or Ctrl+click) opens the full form filled in. Works in all 11 languages (`src/shared/lib/quick-*.ts`, tests in `quick-*.test.ts`). The phrase is read in the language of its letters: a Russian phrase works with the English interface, an English one with the Russian interface; the interface language wins when the phrase uses its script, so Latin letters stay Spanish with the Spanish interface (`src/shared/lib/quick-detect.ts`).

- Date: today, tomorrow, the day after tomorrow, weekday names ("next Wednesday" skips today), "Nov 5", "05.11", "in 3 days", "in 2 weeks"; in Russian also a day of the month alone: "14-го", "14 числа", or ", 14" at the end of the line (this month, or the next one if the day has passed). No date: today, or tomorrow if the time has passed.
- Time: "7pm", "19:00", "at 7", "noon", ranges "7-9pm", "from 2 to 3:30pm", and "fri 18" (a number right after a day is an hour).
- Length: "50 min", "2h", "1.5 hours", "half an hour"; one hour by default; no time means all day.
- `#work` picks a calendar by the start of its name, `@Gdynia` sets the location (`@Office_Gdynia` for a name with a space).
- Digits of any script (Arabic-Indic, Devanagari, Bengali, full width) are understood.

| Language | Example |
|---|---|
| English | `tomorrow 7pm English class 50 min #personal` |
| Russian | `завтра 19:00 английский 50 мин #личное` |
| Spanish | `mañana a las 19:00 clase de inglés 50 min` |
| French | `demain 19h cours d'anglais 50 min` |
| Portuguese | `amanhã 19h aula de inglês 50 min` |
| German | `morgen 19 Uhr Englischkurs 50 min` |
| Japanese | `明日19時 英会話 50分` |
| Chinese | `明天晚上7点 英语课 50分钟` |
| Hindi | `कल शाम 7 बजे इंग्लिश क्लास 50 मिनट` |
| Arabic | `غدًا الساعة 7 مساءً درس إنجليزي 50 دقيقة` |
| Bengali | `কাল সন্ধ্যা 7টায় ইংরেজি ক্লাস 50 মিনিট` |

## Search

- `Ctrl+F` or `/`: searches titles, descriptions and locations in the visible calendars through Google, two years back and forward. Upcoming results first, then past ones from newest; a click opens the event on its day.

## Video calls

- Events with a call get "Join": in the card, in the widget from 15 minutes before the start until the end, in the tray agenda, in the reminder notification and in the hard-to-miss alert.
- "Add Google Meet video call" in the form of a new event or of an event without a call: Google creates the call when the event is saved, and the card gets Join (`conferenceData.createRequest`, within the `calendar.events` permission).
- The link comes from the event's conference (Google Meet, Zoom or Teams add-ons) or from a Meet, Zoom, Teams, Webex, Telemost, Jitsi, Whereby, GoTo, Chime or Skype link in the location or description (`src/shared/lib/meeting.ts`).

## Reminders and the hard-to-miss alert

- Windows notifications for the popup reminders set in Google, on the event or as the calendar's default. All-day events only get reminders set on the event itself (Google does not return the all-day defaults).
- The schedule for the next 48 hours is rebuilt every 5 minutes and kept by the Rust side, so reminders come on time even when the window is hidden (`src-tauri/src/reminders.rs`).
- "Hide titles in notifications": shows "Event" and the time instead, for the lock screen.
- Hard-to-miss alert (off by default; for calls only or for all timed events): a small window over everything a minute before the start, with Join, Snooze 5 min and Dismiss; Enter joins, Esc dismisses. A snoozed alert comes back even after the schedule is refreshed.

## Desktop widget

- Clock, countdown to the next or current event, a month with dots on busy days, the next five events (holidays included), Join for calls, and a quick add field.
- Arrows switch months, a click on the month name goes back to today; a click on a day or an event opens the calendar there.
- Drag it by any spot; its place is remembered. Glass effect and theme follow the calendar.
- Shown, hidden and kept on top from the tray menu. When Windows starts the app, only the widget appears.

## Tray

- Left click: the agenda for today and tomorrow above the taskbar, with Join for calls about to start and "Open calendar"; it hides on Esc or when focus leaves.
- Right click: open calendar, show or hide the widget, keep the widget on top, start with Windows, quit.
- Closing the main window hides it to the tray.

## Look and feel

- Theme: system, light or dark; the widget follows.
- Style (Settings → Style): Classic, Paper, Obsidian, Showcase, Monochrome. Each style has a light and a dark version and follows the theme; the widget, the tray agenda and the alert follow the style. A style is a set of CSS variables on `<html data-style>` (`src/styles/styles.css`, `src/shared/lib/appearance.ts`); the classic values are in `src/styles/global.css`. In the settings each style has a small preview drawn with its own variables.
- Fonts (Settings → Style): one font for headings and numbers (period title, day numbers, the widget clock), one for text. "Style default" uses the style's pair: Segoe UI (Classic), Cormorant Garamond + Inter (Paper), Manrope (Obsidian), Unbounded + Onest (Showcase), Geist Mono + Geist (Monochrome). Unbounded and Cormorant Garamond are offered for headings only. The fonts are variable WOFF2 files from `@fontsource-variable` packages (SIL Open Font License 1.1), built into the app; letters a font lacks (Arabic, Devanagari, Bengali, Chinese, Japanese) come from the Windows fonts of that script. The choice is kept per computer, like the theme.
- Glass effect (on by default): the Windows Acrylic backdrop in the main window and the widget; the main window turns opaque when it loses focus, as Windows does.
- Right-to-left layout for Arabic: all spacing uses logical CSS properties.
- The toolbar fits the smallest window size (760 px).

## Languages and regions

- 11 languages: English, Russian, Spanish, French, Portuguese, German, Japanese, Chinese (Simplified), Hindi, Arabic and Bengali. The language follows Windows and can be changed in Settings. The tray menu, the browser sign-in page and Google's consent screen follow it too.
- Dates, the first day of the week, 12- or 24-hour time and digits follow the region.
- The translations were written by Claude and are not yet checked by native speakers.

## Offline

- The last 80 Google responses are cached, so the calendar opens and shows the last loaded weeks without a network; a banner says "Offline. Showing data from …". The cache is cleared on sign-in and sign-out (`src/shared/api/cache.ts`).

## Settings

Gear button in the toolbar:

- Theme, language.
- Second time zone and its zone.
- Week numbers.
- Holidays: a country or "Don't show".
- Glass effect.
- Event notifications, hide titles in notifications.
- Hard-to-miss alert: off, calls only, all events.
- Log: "Open log folder".
- The dialog scrolls when the window is low.
- The widget, keeping it on top and starting with Windows live in the tray menu.

## Keyboard shortcuts

`←` `→` back and forward, `T` today, `D` `W` `M` `A` Day, Week, Month and Schedule, `N` quick add, `Ctrl+K` command menu, `Ctrl+F` or `/` search, `Esc` closes a card, form or dialog, `Enter` in quick add creates and `Ctrl+Enter` opens the form. They work with any keyboard layout.

`?` (or "Keyboard shortcuts" in the command menu) opens the list of all shortcuts in four groups: Calendar, Create, On an event, Anywhere. The quick add shortcut is shown as chosen in Settings, and not at all when it is off. Keys of a combination read left to right in Arabic too. `?` in a text field is just a character (`src/ui/Shortcuts.tsx`, `src/shared/lib/shortcuts.ts`).

Events without the mouse (`src/app/useEventKeys.ts`, `src/shared/lib/spatial.ts`, `src/model/keyboard.ts`): every event block is a button, so Tab reaches it and Enter or Space opens the card. With no event chosen, `↓` picks the first event of the view and `↑` the last. On an event the arrows move to the nearest event on screen in that direction (left and right: the next day, the event closest in time; up and down: the same column first), in Day, Week, Month and Schedule and right to left as well; `←` `→` change the week only when no event is chosen. `E` opens the form of the event, `Ctrl+D` the form of a copy, `Delete` the card with "Click again to delete" already focused (Enter deletes; a series asks "this event or this and following" as usual). When the card or form closes, the focus goes back to the same event.

Quick add from anywhere: a shortcut for the whole of Windows (Ctrl+Alt+Space by default; Ctrl+Shift+Space, Alt+Shift+Space or off in Settings) opens a small quick add window over any app, even when the calendar is in the tray. The window appears in the upper third of the screen with the mouse, the same line and preview as in the sidebar; Enter creates and hides it, Ctrl+Enter opens the full form in the main window, Esc or a click elsewhere hides it. At start, if the chosen shortcut is taken by another app, the next free one from the list is used and saved; choosing a taken one in Settings says so and keeps the old one. Until the calendars load the window shows "Loading…" instead of the line (`src-tauri/src/quick.rs`, `src/quick/QuickWindow.tsx`, `src/shared/lib/hotkeys.ts`).

Command menu (`Ctrl+K`, also from a text field): one line for a date in words in any of the 11 languages ("nov 20", "fri", "завтра"; the same parser as quick add), "Create …" (the full form filled from the line), "Search for …", New event, Today and the four views. Arrows choose, Enter runs, Esc closes (`src/ui/CommandMenu.tsx`, `src/shared/lib/commands.ts`). With an event chosen (the focused event block, or the open card) in a calendar you can change, its name is above the list and its actions come first: Move to tomorrow, An hour later (events with a time), Add Google Meet (events without a call); the 12 colors ("Color: Tomato", "Color: Calendar color") show up when the line matches their name. A series changes only this occurrence, as when dragging; an error goes to the banner.

## Errors and the log

- Errors are shown where they happen, in the interface language: a banner over the calendar for loading problems (with the calendars or accounts that failed), a line in the form for saving problems, a note in the sidebar for an account whose sign-in expired.
- If a window fails to draw, it shows "Something went wrong" with "Restart window" (and "Open log folder" in the main window) instead of a blank page; what was saved is already in Google.
- A log file in `%LOCALAPPDATA%\com.arseni.calmcalendar\logs\calm-calendar.log` (1 MB per file, the last 5 kept): app start with the version, sign-in and sign-out, failed Google requests (method, the request path without ids, the error), failed commands, window errors with their stack, crashes. No event titles or descriptions, no tokens; accounts appear as `a***@gmail.com`. Libraries only log warnings and errors. Settings → "Open log folder" opens it for a support email (`src-tauri/src/logging.rs`, `src/shared/lib/log.ts`).

## Privacy and permissions

- Two Google permissions: calendar events (`calendar.events`) and the calendar list (`calendarlist.readonly`). Everything else (holidays, travel time, shared meetings, guests) works within them.
- No servers of our own: the app talks to Google directly. No analytics. Privacy policy: https://calmcalendar.co.uk/privacy.html.

## Installation and updates

- Installers for Windows (`.exe`, `.msi`) on GitHub Releases, and an MSIX package for the Microsoft Store (`docs/msix.md`).
- Starts with Windows if enabled in the tray menu (through a StartupTask in the Store package).
- What changed in each version: `CHANGELOG.md`.

## Not there yet

Planned next: stage 3a (answering invitations, Google Meet, event colors, duplicate, Ctrl+K command menu, last sync time), the style rework, Google Tasks and finding a time (need new Google permissions), Outlook, location suggestions and maps, native-speaker review of the translations.

## Tests

- Unit tests (`npm test`, `cargo test`).
- Interface tests in Chrome on mock data with a fixed clock, on every push (`e2e/ui`, README → Checks).
- Tests of the real app on Windows under tauri-driver, without Google: main window, widget, hard-to-miss alert, tray agenda, the log without personal data (`e2e/app`, run by hand).
