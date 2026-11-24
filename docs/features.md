# Calm Calendar features

Everything the app can do today, by area. Keep this file up to date with every feature: it is the reference for the README, the Store listing, the website and the release notes. Code paths point to where each feature lives.

Last updated: 2026-11-24 (mutation tests of the unit tests: StrykerJS and cargo-mutants).

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
- [Calendar subscriptions (.ics)](#calendar-subscriptions-ics)
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
- While the app waits for the browser (up to five minutes), the sign-in screen and "Add account" offer "Open the sign-in page again" (the same Google page, for a lost or closed tab) and "Cancel" (stops waiting; not shown as an error) (`src/ui/SignInActions.tsx`).
- Several Google accounts in one window: "Add account" at the bottom of the sidebar. Calendars are grouped by account, each group has "Sign out".
- "Sign out" shows when the mouse or the focus is on its account (Tab reaches it), so a rare action does not catch the eye all the time. It asks a second time ("Sign out?" in red, shown while asking); it goes back after 5 seconds, on Esc or when focus leaves. Signing out revokes the token at Google.
- If Google stops accepting an account's sign-in, its group says so with "Sign in again"; the other accounts keep working.
- Overlaps between accounts: a timed event that overlaps an event of another account gets a red edge, a warning sign and a note in its card ("Overlaps with: …"). All-day events, events marked "free" and the same meeting in both accounts don't count. Travel time counts.
- Tokens are kept per account by the Rust side; the sign-in of version 0.4 is moved over on the first start.
- After the first sign-in, a card "What else Calm Calendar can do" in the bottom corner (`src/ui/Welcome.tsx`): switches for the desktop widget, starting with Windows and the hard-to-miss alert for calls (they change the same settings as the tray menu and Settings, and the tray check marks follow, `get_desktop`, `set_widget`, `set_autostart`), a line about quick add from any app with the chosen shortcut and one about the tray agenda. It does not take the focus, Esc closes it only when the focus is in it, and it is shown once (`calm.welcome` in localStorage); Ctrl+K → "What Calm Calendar can do" opens it again.

## Views

- **Day** and **Week**: hours grid with a line for the current time, all-day events in a strip at the top. Opens at 7:00, or near the current hour when today is on screen in the evening.
- **Month**: six weeks, up to four events per day and "N more".
- **Schedule**: four weeks from the chosen day as a list by day; days without events are skipped. Each row: time or "all day", title, repeat and overlap marks, location. A link in the location shows short: the call service ("Zoom", "Microsoft Teams") or the site, the full text on hover (`shortPlace` in `src/shared/lib/meeting.ts`). From 15 minutes before a call until its end the row has Join, as in the widget.
- Events that have ended are paler (opacity 0.55) in Day, Week, Month and Schedule, as in the tray agenda.
- Mini month in the sidebar: picks a day, shows the range on screen, has its own month arrows.
- Toolbar: Today, back and forward, the period title (with the week number when week numbers are on), search (with a magnifier; when the calendar panel (the window without the side panel) is 1160 px or narrower it folds into the magnifier and opens on Ctrl+F, `/` or a click), free time, refresh, settings, view switch. The icon buttons keep their size; when space runs short the search folds first, then the title is shortened.
- The side panel button at the start of the toolbar hides and shows the side panel (Create, quick add, the mini month, calendars). In a wide window the choice is remembered (`calm.sidebar` in localStorage); at 960 px and narrower the panel is folded and the button pulls it out over the calendar (on an opaque background, even with glass or Obsidian), where Esc or a click outside folds it back. While the panel is hidden the toolbar has a "+" button for a new event, and `N` brings the panel back with the cursor in quick add (`src/model/sidebar.ts`, `src/ui/Sidebar.tsx`).
- When the calendar panel is 1160 px or narrower (the side panel is not counted: CSS container queries on `main`) the four view tabs become one button with a menu (Day, Week, Month, Schedule with their keys; arrows, Enter and Esc work in it), so the toolbar fits down to the smallest window of 760 px with the period title whole (`src/ui/ViewMenu.tsx`).
- Calendars can be shown or hidden one by one; colors come from Google. The choice is remembered in the app.
- Data refreshes every 5 minutes, when the window comes back to the front, and with the refresh button. The bottom of the sidebar says when the calendar was last loaded from Google ("Updated 10:42"; with the date if it was not today).
- When Google does not answer (no network, Google busy or down: 429 and 5xx), the app tries again by itself after 5 seconds, 15 seconds and a minute, then goes on with the usual refresh. The error or "Offline" banner has a Retry button (`src/model/sync.ts`).

## Events

- Create: the "Create" button, a click on an empty slot (Week, Day: that half hour; Month: 9:00 that day), quick add, or the widget.
- The event card shows the time, the time in the event's own zone if it differs, Join for calls, the calendar (and account when there are several), travel time, location (a click opens it in Google Maps in the browser; a link in the location field opens itself, `src/shared/lib/maps.ts`), guests with their answers, description, overlaps, the repeat rule, and "In Google".
- The card opens next to its event, not in the middle of the window: after the event in reading direction (before it in Arabic), on the other side when there is no room, under or over a wide event; it never leaves the window and the calendar around it is not dimmed. With no room at any side, or when the event is not on screen (opened from search on another week), it opens in the middle as before. "Edit" moves to the form in the middle of the window (`src/shared/lib/beside.ts`, `src/ui/useBeside.ts`).
- The form: title, all day, start and end date and time, repeat, calendar, location, description (hint "Agenda, links, notes"), "Add Google Meet video call", guests, and "More" with time zone, travel time, color and attachments. "More" is closed for a new event and opens by itself when the event has another zone, travel time, its own color or attachments; the closed line lists what is inside. Save, Cancel and Delete (and the error and the "this event or following" question) stay at the bottom of the form while it scrolls (`src/ui/EventEditor.tsx`).
- Move an event to another calendar of the same account (Google does not move events between accounts).
- Saving an existing event sends Google only the fields changed in the form (start and end always together); with nothing changed no request goes out. So a change made in Google while the form was open stays, unless the same field was changed here too. A move in the grid, its Undo and Ctrl+K changes send only their own fields (`changedFields` and `patchEvent` in `src/shared/api/calendar.ts`).
- The form checks dates and times before saving: a cleared field, a date that does not exist (30 February) and a time skipped by the switch to summer time in the event's zone (02:30 on 29 March in Warsaw) give "Check the date and time". A change in the form while the "this event or following" question is open hides the question. A save still running when the form is closed does not close the next event opened; its error goes to the banner (`src/model/editor.ts`).
- Delete works with one click (a recurring event asks "This event" or "This and following"). The event leaves the screen at once; a line at the bottom says "Deleted: …" with Undo, × and Ctrl+Z. The event is deleted in Google only when the line closes (8 seconds, 4 more after the mouse or focus leaves it), when the next move or delete comes, or when the window closes; so Undo brings it back untouched and guests get no emails. A refresh while the line is shown keeps it hidden; "this and following" hides occurrences by their date in the series rule, as Google deletes them. Undo leaves out events of a calendar hidden in the meantime and reloads the list. Signing out while the line is shown first sends the delete, then signs out. Every delete is kept in a journal on disk (`calm.pendingDeletes`) from the moment it is chosen until Google answers; if the app quits before that (Quit in the tray closes it at once), the delete is sent once the sign-in of its own account works again. No network or an expired sign-in keeps it in the journal for the next try; Google refusing it for good (the event is already gone) removes it. A move saved while a delete is pending does not replace the "Deleted" line; Undo of a move also refreshes the widget and the tray agenda; a failed delete goes to the banner and the event comes back (`src/model/undo.ts`, `src/ui/UndoToast.tsx`).
- Attachments: the card lists the Google Drive files attached to the event, a click opens one in the browser. In the form a Drive file is attached by pasting its link (Docs, Sheets, Slides, Forms or a Drive file; other links are refused), and removed with ×; up to 25. Attachments go to Google only when the list was changed, so editing and dragging keep them, and "this and following" passes them to the new series. Uploading a file from the computer needs a Google Drive permission (stage 3b) (`src/shared/lib/attachments.ts`).
- Color of a single event: the calendar color or one of Google's 11 event colors (Lavender … Tomato), as on the Google Calendar website. Shown in every view, the card, the widget and the tray agenda; stored in Google (`colorId`), so the website and phones show it too (`src/shared/lib/colors.ts`).
- "Duplicate" in the card opens the form of a new event with the same title, time, time zone, location, description, travel time and guests. An occurrence of a series is copied as one event; the old video call and the guests' answers are not copied. An event from a read-only calendar (holidays, someone else's calendar) is copied into your first calendar.
- Week and Day: drag an event to another time or day, drag its bottom edge to change the length; 30-minute snap on click, 15-minute step when dragging, Esc cancels. The change is saved at once and keeps the event's time zone; the line "Moved: …" appears at the bottom once Google has saved the move, with Undo (also Ctrl+Z); Undo changes only the time and its time zone back, so a color or place changed meanwhile stays. Ctrl+K "Move to tomorrow" and "An hour later" get the same line.
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
- Copy puts the text on the clipboard. The options are remembered. With nothing free the panel says why ("No free time left in these hours on the days on screen"), Copy is off and "Show the next days" moves the calendar on.

## Holidays and week numbers

- Holidays (Settings): the public holidays of one of 76 countries, from Google's public holiday calendars, with names in the app language when Google has them. The countries are listed in the alphabetical order of the app language. Shown as a separate "Holidays" group in the sidebar, in the widget and in the tray agenda. Kept only in the app: adding a calendar to the Google calendar list would need another Google permission. If the same country's holidays are already in your Google calendars, they are not shown twice.
- Week numbers (Settings): ISO 8601 numbers in the mini month, in the Month view and next to the week title.

## Calendar subscriptions (.ics)

- Settings → Calendar subscriptions: paste the link of an `.ics` calendar (a class schedule, sports fixtures, a calendar published from Outlook); `webcal://` links work too. The app downloads it first: a web page instead of a calendar, a dead link or a link that is already added gets a message. The name comes from the calendar (`X-WR-CALNAME`), otherwise the site's address; colors go round a small palette.
- The calendars are shown in a "Subscriptions" group in the sidebar, in the widget and in the tray agenda, can be hidden like any calendar, are read only (Duplicate copies an event into your own calendar) and are found by search. Kept only in the app: adding a calendar by link to Google would need another Google permission.
- The file is downloaded by Rust (`fetch_feed`, up to 10 MB, http, https and webcal only; the log and error messages get only the site's host, as the path may hold a secret key; a date or time that does not exist, like 30 February, is skipped rather than moved to another day) and parsed in the interface: time zones (IANA, Outlook's Windows names, `/mozilla.org/…` prefixes), all-day events, DURATION, repeats with INTERVAL, COUNT, UNTIL, BYDAY (also "2nd Tuesday", "last Friday"), BYMONTHDAY, BYMONTH, plus EXDATE, RDATE and moved occurrences (RECURRENCE-ID); cancelled events are skipped. A rule with anything else (BYSETPOS…) shows only the first event of the series. Video call links in the location or description get the Join button.
- A downloaded calendar is kept in memory for 10 minutes (Refresh downloads it again); the last copy up to 1.5 MB is saved for offline use and deleted with the subscription (`src-tauri/src/feeds.rs`, `src/shared/lib/ics.ts`, `src/shared/lib/feeds.ts`, `src/shared/api/feeds.ts`).

## Quick add

A field under the "Create" button and in the widget; `N` focuses it. One line, a live preview of how it was understood (its hint says "Enter or click to add"); Enter or a click on the preview creates, Ctrl+Enter (or Ctrl+click) opens the full form filled in. Works in all 13 languages (`src/shared/lib/quick-*.ts`, tests in `quick-*.test.ts`). The phrase is read in the language of its letters: a Russian phrase works with the English interface, an English one with the Russian interface; Russian, Ukrainian and Belarusian are told apart by the letters only one of them has (ў; ї, є, ґ; ы, э, ъ), otherwise the interface language wins; the interface language wins when the phrase uses its script, so Latin letters stay Spanish with the Spanish interface (`src/shared/lib/quick-detect.ts`).

- Date: today, tomorrow, the day after tomorrow, weekday names ("next Wednesday" skips today), "Nov 5", "05.11", "in 3 days", "in 2 weeks"; in Russian also a day of the month alone: "14-го", "14 числа", or ", 14" at the end of the line (this month, or the next one if the day has passed). No date: today, or tomorrow if the time has passed.
- Time: "7pm", "19:00", "at 7", "noon", ranges "7-9pm", "from 2 to 3:30pm", and "fri 18" (a number right after a day is an hour). A time with a colon the clock does not have ("25:30", "9:75") shows "Check the date and time" instead of an all-day event (`src/shared/lib/quick.ts`).
- Length: "50 min", "2h", "1.5 hours", "half an hour"; one hour by default; no time means all day.
- `#work` picks a calendar by the start of its name, `@Gdynia` sets the location (`@Office_Gdynia` for a name with a space).
- Digits of any script (Arabic-Indic, Devanagari, Bengali, full width) are understood.
- The title starts with a capital letter: "tomorrow 7pm dinner with Ola" becomes "Dinner with Ola". Only the first letter changes; a first word with capitals of its own ("iPhone repair") stays as typed (`capitalizeTitle` in `src/shared/lib/quick-core.ts`).

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

- Clock, countdown to the next or current event (a long title is shortened, the time left never), a month with dots on busy days, the next five events (holidays included), Join for calls, and a quick add field.
- Arrows switch months, a click on the month name goes back to today; a click on a day or an event opens the calendar there.
- Drag it by any spot; its place is remembered. Glass effect and theme follow the calendar.
- Shown, hidden and kept on top from the tray menu. When Windows starts the app, only the widget appears.

## Tray

- Left click: the agenda for today and tomorrow above the taskbar, with Join for calls about to start and "Open calendar"; it hides on Esc or when focus leaves.
- Right click: open calendar, show or hide the widget, keep the widget on top, start with Windows, quit.
- Closing the main window hides it to the tray.

## Look and feel

- Theme: system, light or dark, in Settings or from Ctrl+K ("Theme: Dark"); the widget follows. There is no theme button on the toolbar.
- Style (Settings → Style): Classic, Paper, Obsidian, Showcase, Monochrome. Each style has a light and a dark version and follows the theme; the widget, the tray agenda and the alert follow the style. A style is a set of CSS variables on `<html data-style>` (`src/styles/styles.css`, `src/shared/lib/appearance.ts`); the classic values are in `src/styles/global.css`. In the settings each style has a small preview drawn with its own variables.
- Fonts (Settings → Style): one font for headings and numbers (period title, day numbers, the widget clock), one for text. "Style default" uses the style's pair: Segoe UI (Classic), Cormorant Garamond + Inter (Paper), Manrope (Obsidian), Unbounded + Onest (Showcase), Geist Mono + Geist (Monochrome). Unbounded and Cormorant Garamond are offered for headings only. The fonts are variable WOFF2 files from `@fontsource-variable` packages (SIL Open Font License 1.1), built into the app; letters a font lacks (Arabic, Devanagari, Bengali, Chinese, Japanese) come from the Windows fonts of that script. The choice is kept per computer, like the theme.
- Glass effect (on by default): the Windows Acrylic backdrop in the main window and the widget; the main window turns opaque when it loses focus, as Windows does.
- Right-to-left layout for Arabic: all spacing uses logical CSS properties.
- The period title keeps its full length in every language down to the smallest window (760 px): the search field folds into a magnifier and the view tabs into a menu when the calendar panel is 1160 px or narrower, the side panel folds away at 960 px (`src/ui/Toolbar.module.css`, `src/ui/Search.module.css`, `src/model/sidebar.ts`).

## Languages and regions

- 13 languages: English, Russian, Ukrainian, Belarusian, Spanish, French, Portuguese, German, Japanese, Chinese (Simplified), Hindi, Arabic and Bengali. The language follows Windows and can be changed in Settings. The tray menu, the browser sign-in page and Google's consent screen follow it too.
- Dates, the first day of the week, 12- or 24-hour time and digits follow the region.
- The translations were written by Claude and are not yet checked by native speakers.

## Offline

- The last 80 Google responses are cached, so the calendar opens and shows the last loaded weeks without a network; a banner says "Offline. Showing data from …". The cache is cleared on sign-in and sign-out (`src/shared/api/cache.ts`).

## Settings

Gear button in the toolbar. Settings open in a window of their own without a frame, in the middle of the calendar window and above it; it can be dragged by its header (the cursor shows four arrows there) anywhere on the screen, also outside the calendar. × or Esc closes it, hiding the calendar to the tray closes it too; each opening starts in the middle again. Second time zone, week numbers and holidays changed there reach the calendar window at once (bus event `display-changed`). In the browser (`npm run dev`) Settings are a dialog over the page, dragged by the header inside the page (`src-tauri/src/settings.rs`, `src/settings/SettingsWindow.tsx`, `src/ui/useDraggable.ts`).

The window is 720 × 560: the list of sections at the start edge (on the right in Arabic), the options of one section next to it. A click opens a section, ↑ and ↓ move along the list; Look is open first. What was typed or chosen in a section stays while another one is open. Only the open section scrolls, the header and the list stay in place (`role="tablist"` and `role="tabpanel"` in `src/ui/Settings.tsx`).

The sections:

- **Look**: theme, style, the two fonts, glass effect.
- **Calendar**: language, second time zone, week numbers, holidays (a country or "Don't show"), calendar subscriptions.
- **Reminders**: event notifications, hide titles in notifications, hard-to-miss alert (off, calls only, all events).
- **Quick access**: the quick add shortcut, the desktop widget, keeping it on top, starting with Windows. The last three are the same switches as in the tray menu, whose check marks follow (`get_desktop`, `set_widget`, `set_autostart`); in the browser they are off.
- **Help**: "Write to us" and, in the app only, "Open log folder". "Write to us" is a form for a suggestion, a problem or a question: the kind, the text, "Open in mail" and "Copy the text". "Open in mail" opens a letter to support@calmcalendar.co.uk in the user's own mail app (`mailto:`), with the subject "Calm Calendar 0.12.4: Problem" and, under the text, the app version, where it was installed from (Microsoft Store or installer), the interface language and the WebView2 and Windows line. The app sends nothing itself: the user sees the whole letter and sends it. A text too long for a link (about 1900 characters after encoding) is put on the clipboard, and the letter opens with "(Paste the copied text here: Ctrl+V)" in its place. "Copy the text" copies the whole letter for a web mailbox and shows the address. The text stays in the form after sending (`src/ui/FeedbackForm.tsx`, `src/shared/lib/feedback.ts`).
- In a low window the open section scrolls.
- Under the list of sections: the app version ("Version 0.14.1"), the same number as in `package.json`, `tauri.conf.json` and `Cargo.toml`; it can be selected and copied (`src/shared/lib/version.ts`). Under it, "What's new" opens this version's notes in the browser: `https://calmcalendar.co.uk/whats-new.html#v<version>`. The page is built from `CHANGELOG.md` with the website (`scripts/build-site.mjs`, `scripts/lib/changelog.mjs`), in English only.

## Keyboard shortcuts

`←` `→` back and forward, `T` today, `D` `W` `M` `A` Day, Week, Month and Schedule, `N` quick add, `Ctrl+K` command menu, `Ctrl+F` or `/` search, `Ctrl+Z` undoes the last move or delete while its line is shown, `Esc` closes a card, form or dialog, `Enter` in quick add creates and `Ctrl+Enter` opens the form. They work with any keyboard layout.

`?` (or "Keyboard shortcuts" in the command menu) opens the list of all shortcuts in four groups: Calendar, Create, On an event, Anywhere. The quick add shortcut is shown as chosen in Settings, and not at all when it is off. Keys of a combination read left to right in Arabic too. `?` in a text field is just a character (`src/ui/Shortcuts.tsx`, `src/shared/lib/shortcuts.ts`).

Events without the mouse (`src/app/useEventKeys.ts`, `src/shared/lib/spatial.ts`, `src/model/keyboard.ts`): every event block is a button, so Tab reaches it and Enter or Space opens the card. With no event chosen, `↓` picks the first event of the view and `↑` the last. On an event the arrows move to the nearest event on screen in that direction (left and right: the next day, the event closest in time; up and down: the same column first), in Day, Week, Month and Schedule and right to left as well; `←` `→` change the week only when no event is chosen. `E` opens the form of the event, `Ctrl+D` the form of a copy, `Delete` the card with Delete already focused (Enter deletes, Ctrl+Z brings it back; a series asks "this event or this and following" as usual). When the card or form closes, the focus goes back to the same event.

Quick add from anywhere: a shortcut for the whole of Windows (Ctrl+Alt+Space by default; Ctrl+Shift+Space, Alt+Shift+Space or off in Settings) opens a small quick add window over any app, even when the calendar is in the tray. The window appears in the upper third of the screen with the mouse, the same line and preview as in the sidebar; Enter creates and hides it, Ctrl+Enter opens the full form in the main window, Esc or a click elsewhere hides it. At start, if the chosen shortcut is taken by another app, the next free one from the list is used and saved; choosing a taken one in Settings says so and keeps the old one. Until the calendars load the window shows "Loading…" instead of the line (`src-tauri/src/quick.rs`, `src/quick/QuickWindow.tsx`, `src/shared/lib/hotkeys.ts`).

Command menu (`Ctrl+K`, also from a text field): one line for a date in words in any of the 13 languages ("nov 20", "fri", "завтра"; the same parser as quick add), "Create …" (the full form filled from the line), "Search for …", New event, Today, the four views, Keyboard shortcuts and "What Calm Calendar can do"; typing a name also finds "Free time" and "Theme: Light / Dark / System". Arrows choose, Enter runs, Esc closes (`src/ui/CommandMenu.tsx`, `src/shared/lib/commands.ts`). With an event chosen (the focused event block, or the open card) in a calendar you can change, its name is above the list and its actions come first: Move to tomorrow, An hour later (events with a time), Add Google Meet (events without a call); the 12 colors ("Color: Tomato", "Color: Calendar color") show up when the line matches their name. A series changes only this occurrence, as when dragging; an error goes to the banner.

## Errors and the log

- Errors are shown where they happen, in the interface language: a banner over the calendar for loading problems (with the calendars or accounts that failed), a line in the form for saving problems, a note in the sidebar for an account whose sign-in expired.
- If a window fails to draw, it shows "Something went wrong" with "Restart window" (and "Open log folder" in the main window) instead of a blank page; what was saved is already in Google.
- A log file in `%LOCALAPPDATA%\com.arseni.calmcalendar\logs\calm-calendar.log` (1 MB per file, the last 5 kept): app start with the version, sign-in and sign-out, failed Google requests (method, the request path without ids, the error), failed commands, window errors with their stack, crashes. No event titles or descriptions, no tokens; accounts appear as `a***@gmail.com`; for an .ics subscription only the site's address, never the link with its key (`without_url` in `src-tauri/src/feeds.rs`). Libraries only log warnings and errors. Settings → "Open log folder" opens it for a support email (`src-tauri/src/logging.rs`, `src/shared/lib/log.ts`).

## Privacy and permissions

- Two Google permissions: calendar events (`calendar.events`) and the calendar list (`calendarlist.readonly`). Everything else (holidays, travel time, shared meetings, guests) works within them.
- No servers of our own: the app talks to Google directly, and to the sites of .ics subscriptions you add. No analytics. Privacy policy: https://calmcalendar.co.uk/privacy.html.

## Installation and updates

- Installers for Windows (`.exe`, `.msi`) on GitHub Releases, and the Microsoft Store: https://apps.microsoft.com/detail/9N5HZ8P1QRMW (MSIX package, `docs/msix.md`). The website's main button leads to the Store page.
- Starts with Windows if enabled in the tray menu (through a StartupTask in the Store package).
- Rating in Microsoft Store, the Store build only (a package signed by the Store; the installers from GitHub never ask): two weeks after the first day of use a card "Enjoying Calm Calendar?" shows in the bottom corner of the main window, without taking the focus and not while the first-start card is open. "Rate in Store" opens the Store's own rating dialog over the window (`StoreContext.RequestRateAndReviewAppAsync`; when Windows refuses it, the app's review page in the Store app), "Not now" or the cross closes the card. After either answer it never shows again (`calm.rating` in localStorage: the first day and the answer). Nothing is sent anywhere by the app itself (`src/model/rating.ts`, `src/ui/RateCard.tsx`, `src-tauri/src/store.rs`). Not checked yet in a package installed from the Store: the dialog needs a Store-signed install.
- What changed in each version: `CHANGELOG.md`; for users, the "What's new" page of the website (https://calmcalendar.co.uk/whats-new.html) and the link to it in Settings.

## Not there yet

Planned next: Google Tasks, attaching a file from the computer through Google Drive and finding a time by colleagues' availability (need new Google permissions), Outlook accounts (not only .ics links), location suggestions and a map in the card, native-speaker review of the translations.

## Tests

- Unit tests (`npm test`, `cargo test`).
- Interface tests in Chrome on mock data with a fixed clock, on every push (`e2e/ui`, README → Checks).
- Tests of the real app on Windows under tauri-driver, without Google: main window, widget, hard-to-miss alert, tray agenda, the log without personal data (`e2e/app`, run by hand).
- Mutation tests of the unit tests: StrykerJS for TypeScript, cargo-mutants for Rust; on pull requests and weekly; a surviving Rust mutant in a pull request's changed lines fails the check (README → Mutation tests).
