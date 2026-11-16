# Changelog

What changed in each version of Calm Calendar, newest first. The section of a version goes to its page on GitHub Releases, so write for people who use the app. Before a release, move "Unreleased" under the new version number and date.

## Unreleased

### Fixed

- **Signing out**: calendars and events of a signed-out account no longer come back when a slow response arrives after sign-out.
- **Paging through weeks**: a late error from a week you already left no longer covers the week on screen or starts a needless retry.
- **Widget and tray agenda**: the list of upcoming events and the dots on the month no longer fall back to older data when two refreshes finish out of order.
- **Event form**: closing the form while it saves and opening another event no longer closes the new form; an error of the earlier save shows in the bar above the calendar.
- **Quick changes**: changing an event's color or video meeting and then dragging it right away no longer puts the old color back; dragging and Ctrl+K changes now send only the fields they change.
- **Recurring meetings in two accounts**: opening the same invitation in one account and then in another no longer fills the form with the repeat rule of the first copy.
- **Search**: results of the previous text no longer show under a new one while the next search waits, and Enter no longer opens an event from them.

## 0.12.1 — 2026-11-16

### Fixed

- **Clock changes and time zones**: events keep their dates and times around the switch to and from summer time — on the day of the change they stand in the right rows, moving or editing one keeps its length, and all-day events no longer lose a day. After Windows changes its time zone the calendar shows the right day and time format without a restart.
- **Recurring Google events**: "This and following" splits a series in the right place when the series uses another time zone, extra dates or a week starting on Sunday, and a biweekly series keeps its rhythm after the split.
- **Calendar subscriptions (.ics)**: repeating events follow the calendar's own time zone, yearly events on a fixed day of the month show in every year, and long series show their later dates instead of stopping early.
- **Quick add** picks the next real date for "29 February" and no longer accepts a date that does not exist.

## 0.12.0 — 2026-11-16

### New

- **What else Calm Calendar can do**: after the first sign-in a small card in the corner turns on the desktop widget, starting with Windows and the hard-to-miss alert for calls right there, and tells about quick add from any app and today's agenda in the tray. It does not take the focus and shows once; Ctrl+K → "What Calm Calendar can do" brings it back.
- **Undo**: after moving or deleting an event a line at the bottom says "Moved: …" or "Deleted: …" with Undo (or Ctrl+Z). It stays while the mouse is on it. A deleted event leaves the screen at once and is deleted in Google when the line closes, so Undo brings it back untouched and guests get no emails.

### Changed

- **Sign out** next to an account shows only when the mouse or the focus is on that account.
- **Settings in groups**: Look, Calendar, Reminders, Quick access and Help. The desktop widget, keeping it on top and starting with Windows can now be changed in Settings too, not only in the tray menu.
- **A calmer toolbar**: the theme button is gone (the theme is in Settings and in Ctrl+K: "Theme: Dark"), Ctrl+K also finds "Free time". The search field has a magnifier and in a narrower window folds into it, so the buttons and the date keep their room.
- **Free time** with nothing free says why and offers "Show the next days"; Copy is off when there is nothing to copy.
- **No more cut-off dates and countdowns**: the period title in the toolbar keeps its full length (the search field gets narrower first), and the widget shortens the event title, never "in 11 min".
- **Past events are paler** in Day, Week, Month and Schedule, so what comes next stands out.
- **Schedule**: a call link in the place shows as "Zoom", "Microsoft Teams" and so on instead of a long address, and from 15 minutes before a call its row has Join.
- **The event form is shorter**: time zone, travel time, color and attachments are under "More" (it opens by itself when the event uses one of them). The description moved up, right after the place, with the hint "Agenda, links, notes". Save and Cancel stay at the bottom of the form, also in a low window.
- **Delete** works with one click; there is no "Click again to delete" any more, Undo takes its place. A recurring event still asks "This event" or "This and following".
- **Signing in**: while the app waits for the browser, "Open the sign-in page again" brings back a lost or closed Google tab, and "Cancel" stops waiting at once instead of after five minutes.

## 0.11.0 — 2026-11-13

### New

- **Ukrainian and Belarusian**: the interface, the tray menu and quick add now speak Українська and Беларуская (Settings → Language, or it follows Windows). Quick add tells Russian, Ukrainian and Belarusian phrases apart by their letters, so "заўтра 19:00 кава" works with any interface language.

## 0.10.0 — 2026-11-11

### New

- **Calendar subscriptions**: add a calendar by its .ics link in Settings — a class schedule, sports fixtures, a calendar from Outlook. It is shown in its own group, read only, also in the widget and offline.
- **Location on the map**: click the location in the event card to open it in Google Maps.

## 0.9.1 — 2026-11-11

### Changed

- Settings open in a window of their own: drag it by its header anywhere on the screen, also outside the calendar.
- The country list of Holidays in Settings is in alphabetical order; the country of Windows is no longer put first.

### Fixed

- The circle around today's date in the month view and the mini calendar is now centered on the number.

## 0.9.0 — 2026-11-10

### New

- **Styles**: besides the classic look there are four new ones in Settings → Style: Paper (warm paper, serif headings), Obsidian (glass with a champagne accent), Showcase (floating panels, solid event colors) and Monochrome (black and white, monospaced digits, one signal color). Each has a light and a dark version and follows the Theme setting; the widget and the tray agenda follow the style.
- **Fonts**: pick the font for headings and numbers and the font for text, or keep the style's own. Inter, Manrope, Onest, Geist, Geist Mono, Unbounded and Cormorant Garamond are built into the app and work offline; Segoe UI is the Windows font.

## 0.8.0 — 2026-11-10

### New

- **Quick add from anywhere**: press Ctrl+Alt+Space in any app, type "fri 18 call with Ola", Enter. Works even when the calendar is in the tray. The shortcut can be changed or turned off in Settings; if another app already uses it, the next free one is taken.
- **Events without the mouse**: ↓ or ↑ picks an event, the arrows move to the nearest event on screen, Enter opens it, E edits, Ctrl+D duplicates, Delete asks in the card and Enter deletes.
- **Command menu on an event**: choose an event and press Ctrl+K to move it to tomorrow, an hour later, add Google Meet or change its color ("tomato").
- **All keyboard shortcuts in one list**: press ? (or "Keyboard shortcuts" in the Ctrl+K menu).

### Changed

- The hint under quick add says that a click on it also creates the event.

## 0.7.1 — 2026-11-10

### Fixed

- **Quick add**: click the preview to create the event (Enter still works).
- **Quick add** understands a phrase in another language than the interface: "занятие спортом в 12:00" works with the English interface.
- **Quick add** in Russian: a day of the month alone, "14-го", "14 числа" or ", 14" at the end.

## 0.7.0 — 2026-11-10

### New

- **Add Google Meet**: a switch in the event form creates a video call when the event is saved.
- **Duplicate** an event from its card, then change what differs.
- **Event colors**: give one event its own color, one of the 11 colors of Google Calendar.
- **Answer invitations** from the event card: yes, no or maybe.
- The sidebar shows **when the calendar was last updated** from Google.
- **Attachments**: see the Google Drive files of an event in its card, and attach one by pasting its link.
- **Command menu** on Ctrl+K: go to a date written in words, create an event, search or switch the view without the mouse.

### Changed

- When Google does not answer, the app tries again by itself, and the error banner has a **Retry** button.

## 0.6.0 — 2026-11-10

### New

- **Schedule view** (key A): four weeks as a list by day.
- **Week numbers** in the mini calendar, the Month view and the week title (Settings).
- **Holidays** of 76 countries in the calendar, the widget and the tray agenda (Settings). No new Google permissions are needed.
- **Free time**: the gaps between your events in working hours as text for a messenger, with Copy (clock button in the toolbar).
- **Guests**: invite people by email from the event form, see who is going; Google emails them the invitation, changes and cancellation.
- **Travel time** before an event: a field in the form, a hatched strip in the calendar, counted as busy.
- A meeting that two of your accounts are invited to is shown once, and its card says where else it is.
- **Log** for support: Settings → "Open log folder". It has no event titles, passwords or full email addresses.

### Changed

- "Sign out" next to an account asks a second time.
- The toolbar fits the smallest window size.
- If a window fails to draw, it offers to restart instead of showing a blank page.

### Fixed

- Settings could not be scrolled in a low window, so the last options were out of reach.

## 0.5.0 — 2026-11-09

### New

- **Several Google accounts in one window.** Calendars are grouped by account, each with "Sign out"; "Add account" at the bottom of the sidebar. Events that overlap an event of another account are marked red. Your existing sign-in moves over by itself.
- **Recurring events**: create them with presets or your own rule (interval, weekdays, "2nd Tuesday", an end date or a number of times); edit or delete "this event" or "this and following".
- **Time zones**: a time zone field in the event form with "your time" below it, and an optional second time zone column in Week and Day. Events keep their Google time zone when edited or dragged.

## 0.4.0 — 2026-11-09

### New

- **Join button** for Google Meet, Zoom, Teams and other video calls: in the event card, the widget and the reminder notification.
- **Hard-to-miss alert** (optional): a small window over everything a minute before a meeting, with Join, Snooze 5 min and Dismiss.
- **Tray agenda**: today's and tomorrow's events on a left click of the tray icon.

## 0.3.0 — 2026-11-08

### New

- The interface and quick add in nine more languages: Spanish, French, Portuguese, German, Japanese, Chinese (Simplified), Hindi, Arabic (right to left) and Bengali.

## 0.2.0 — 2026-11-08

The first public version.

- Google Calendar in a Windows app: day, week and month views, create, edit, move and delete events, drag to change the time, search.
- Quick add from one line in English and Russian.
- Desktop widget with a clock, a countdown, the month and the next events.
- Reminders as Windows notifications, a tray icon, start with Windows.
- Light and dark themes and a glass effect.
- Works offline from the last loaded data.
- English and Russian interface; the language follows Windows.
- A package for the Microsoft Store.
