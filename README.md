# Calm Calendar

An ad-free calendar for Windows that works with Google Calendar. Day, week and month views, a desktop widget, quick add from a single line, reminders as Windows notifications, drag and drop, and search.

The interface and quick add work in 11 languages: English, Russian, Spanish, French, Portuguese, German, Japanese, Chinese (Simplified), Hindi, Arabic (right to left) and Bengali. The language follows Windows and can be changed in Settings → Language. Dates follow the region: in en-US the week starts on Sunday and times use AM/PM.

Stack: Tauri 2 (Rust), React 19, TypeScript, Effector, CSS Modules. Dates use plain `Date` and `Intl`, no date libraries.

## Features

### Calendar

- Day, week and month views, a mini month in the sidebar, a line for the current time.
- Create, edit and delete events. Clicking an event opens its details; editing starts from the Edit button.
- Move an event between calendars. For a recurring event, changes apply to that occurrence only.
- Show or hide individual calendars. Colors come from Google.
- Week and day views: drag an event to change its time or day, drag the bottom edge to resize. 15-minute step, `Esc` cancels, the change is saved right away.
- Search across visible calendars (title, description, location) through the Google API, two years back and forward.
- Theme: system, light or dark. The widget follows the calendar.

### Widget and tray

- A desktop widget with a clock, a countdown to the next or current event ("Muay Thai через 25 мин"), a month with dots on days that have events, the next five events and a quick add field.
- Arrows next to the month name switch months; clicking the name goes back to the current month.
- Clicking a day or an event opens the calendar on that day; clicking the clock just opens the calendar.
- Drag the widget by any spot, its position is remembered.
- Closing the main window hides it to the tray. Tray menu: open calendar, show or hide the widget, keep the widget on top, launch at Windows sign-in, quit.
- When started with Windows, only the widget appears.

### Glass effect

Settings (gear icon in the toolbar) → "Эффект стекла", on by default.

- Main window: the system Acrylic backdrop. Windows turns it off when the window loses focus, so the interface switches to an opaque background at that moment.
- Widget: Acrylic through the window accent policy, because the widget is almost never focused. The system Acrylic backdrop goes dark for unfocused windows, and the Blur effect renders black on recent Windows 11 builds.
- Corners of the widget window are rounded by Windows 11 (DWM).

### Quick add

A field under the "Create" button and in the widget; `N` focuses it. Type the event on one line and a preview shows how it was understood. The field understands the interface language.

English:

- Date: `today`, `tonight`, `tomorrow`, `the day after tomorrow`, `fri`, `on Friday`, `next wed` (skips today), `Nov 5`, `5th of November`, `in 3 days`, `in 2 weeks`. No date means today, or tomorrow if the time has already passed.
- Time: `7pm`, `7:30 am`, `19:00`, `at 7`, `noon`, `7-9pm`, `from 2 to 3:30pm`, `11am-1pm`, and `fri 18` (a number right after a day is an hour). `tonight at 8` means 20:00.
- Duration: `50 min`, `2h`, `1.5 hours`, `half an hour`.

Russian:

- Date: `сегодня`, `завтра`, `послезавтра`, `пт`, `в пятницу`, `5 ноября`, `05.11`, `через 3 дня`. No date means today, or tomorrow if the time has already passed.
- Time: `19:00`, `в 19`, `в 7 вечера`, `с 19 до 21`, `19-21`, and `пт 18` (a number right after a day is an hour).
- Duration: `50 мин`, `2 ч`, `1,5 часа`, `полчаса`. One hour by default. No time means an all-day event.
- `#работа` picks a calendar by the start of its name, `@Гдыня` sets the location (`@Офис_Гдыня` for a name with a space).
- `Enter` creates the event, `Ctrl+Enter` opens the full form with the fields filled in.

Other languages follow the same idea, with their own words for dates, times and durations (each has tests in `src/shared/lib/quick-xx.test.ts`):

| Language | Example |
|---|---|
| Spanish | `mañana a las 19:00 clase de inglés 50 min` |
| French | `demain 19h cours d'anglais 50 min` |
| Portuguese | `amanhã 19h aula de inglês 50 min` |
| German | `morgen 19 Uhr Englischkurs 50 min` |
| Japanese | `明日19時 英会話 50分` |
| Chinese | `明天晚上7点 英语课 50分钟` |
| Hindi | `कल शाम 7 बजे इंग्लिश क्लास 50 मिनट` |
| Arabic | `غدًا الساعة 7 مساءً درس إنجليزي 50 دقيقة` |
| Bengali | `কাল সন্ধ্যা 7টায় ইংরেজি ক্লাস 50 মিনিট` |

Digits of any script (Arabic-Indic, Devanagari, Bengali, full-width) are understood. Shared engines: `quick-eu.ts` (Spanish, French, Portuguese, German, Arabic), `quick-cjk.ts` (Japanese, Chinese), `quick-indic.ts` (Hindi, Bengali).

Examples: `tomorrow 7pm English class 50 min #personal`, `завтра 19:00 английский 50 мин #личное`.

### Reminders

Popup reminders from Google Calendar: set on the event itself or as the calendar default. Every 5 minutes the calendar builds a schedule for the next 48 hours and passes it to the Rust side, which shows Windows notifications. This avoids relying on timers in a hidden window, which Windows may throttle. All-day events only get reminders that are set explicitly: the API does not return the default all-day settings. Can be turned off in Settings.

### Keyboard shortcuts

`←` `→` previous and next, `T` today, `D` `W` `M` day, week and month, `N` quick add, `Ctrl+F` or `/` search, `Esc` close a form. They work with the Russian keyboard layout too.

## How sign-in works

- Sign-in happens in the system browser. The app receives the code on `127.0.0.1` and uses PKCE.
- The refresh token is stored in Windows Credential Manager (Keychain on macOS), not in a file.
- Tokens never reach the web view: the Rust side makes all Google Calendar API requests, the frontend sends only the path and parameters. Only `/calendar/v3/…` paths are allowed.
- Scopes: `calendar.calendarlist.readonly` (calendar list) and `calendar.events` (events), plus `openid email` to show the account address.

## Google Cloud setup (once)

1. Open [console.cloud.google.com](https://console.cloud.google.com) and create a project.
2. APIs & Services → Library → **Google Calendar API** → Enable.
3. Google Auth Platform → Branding: app name, support email and developer contact email.
4. Audience: user type **External**. Then **Publish app** to move it to "In production"; verification is not required for personal use. In "Testing" status the sign-in expires every 7 days, and only test users can sign in.
5. Data Access → Add or remove scopes: add `.../auth/calendar.calendarlist.readonly` and `.../auth/calendar.events`.
6. Clients → Create client → **Desktop app** → create it and download the JSON.
7. Start the app and paste the whole JSON into the "Подключение к Google" form.

On first sign-in Google shows an "unverified app" warning: Advanced → Go to Calm Calendar. An unverified app can be used by up to 100 accounts over its lifetime.

If Publish app stays disabled even with Branding filled in, add your account under Audience → Test users. Others have reported the same issue on the Google developer forum.

The client file is stored at `%APPDATA%\com.arseni.calmcalendar\google-client.json`. For a Store build the client can be baked in at compile time with the `CALM_GOOGLE_CLIENT_ID` and `CALM_GOOGLE_CLIENT_SECRET` environment variables (repository secrets in CI).

## Building on Windows

One-time setup:

1. [Node.js](https://nodejs.org) LTS.
2. [Rust](https://rustup.rs) via `rustup-init.exe`.
3. Microsoft C++ Build Tools with the "Desktop development with C++" workload (the Rust installer offers it).
4. WebView2 ships with Windows 11.

Then:

```powershell
npm install
npm run tauri dev      # development mode
npm run tauri build    # installers in src-tauri\target\release\bundle\
```

## UI development in the browser

`npm run dev` serves the interface at http://localhost:1420 with mock calendars and events (`src/shared/api/mock.ts`). Open `/?window=widget` to see the widget. Mock data is not included in the app build.

## Releases

Every push to `main` runs tests only (the `ci` workflow). Installers come from the `release` workflow:

1. Bump the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`.
2. Commit and tag: `git tag v0.3.0` and `git push origin main v0.3.0`.
3. In 10–15 minutes a release with `.exe` and `.msi` appears under Releases.

To build without a tag: Actions → release → Run workflow. The installers will be in that run's Artifacts.

## Checks

```powershell
npm test               # dates, event layout, quick add parser, reminders, forms
npx tsc --noEmit       # types
cd src-tauri; cargo test
```

## Project layout

```
src/
  app/          root component, timers, keyboard shortcuts
  model/        Effector: auth, view, calendars, events, editor, quick add, reminders, search
  shared/api/   bridge to Rust, Google Calendar API, mock data, events between windows
  shared/lib/   dates, overlapping event layout, quick add parser, drag math, theme, glass
  ui/           components and CSS Modules
  widget/       widget window with its own small model
src-tauri/src/
  oauth.rs      browser sign-in, PKCE, tokens
  google.rs     proxy to the Calendar API
  config.rs     OAuth client, account, widget and app settings
  desktop.rs    windows, tray, autostart, glass effect
  reminders.rs  reminder schedule and Windows notifications
assets/
  icon.png      source for the app icons (npx tauri icon assets/icon.png)
```

## Next

- Microsoft Store release (MSIX) after the app passes Google verification.
