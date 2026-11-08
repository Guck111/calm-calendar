# Calm Calendar Privacy Policy

Effective date: November 8, 2026

Calm Calendar is a desktop calendar app for Windows that works with your Google Calendar. It is developed by Arseni ("we", "us"). This policy explains what data the app accesses, how it is used and stored, and how you can delete it.

The short version: Calm Calendar has no servers of its own. Your calendar data goes only between your computer and Google. We do not collect, receive, sell or share your data, and the app contains no ads, analytics or tracking.

## Data the app accesses

When you sign in with Google, you are asked to grant Calm Calendar the following permissions. The app uses each one only for the feature described.

| Google permission | What the app does with it |
|---|---|
| `calendar.calendarlist.readonly` — see the list of your calendars | Shows your calendars in the sidebar with their names and colors, lets you show or hide each one, and reads each calendar's default reminder times for notifications. |
| `calendar.events` — view and edit events on your calendars | Shows your events in the day, week and month views and in the desktop widget; creates, edits, moves and deletes events when you do so in the app; searches your events when you use search; reads event reminders to show Windows notifications. |
| `openid`, `email` — your Google account email address | Shows which account you are signed in with. |

The app does not access your Gmail, contacts, Google Drive or any other Google data, and it does not change your calendars unless you create, edit, move or delete an event yourself.

## How the data is used

Google user data is used only to provide the calendar features that you see in the app. It is not used for advertising, it is not sold, and it is not used to develop, improve or train artificial intelligence or machine learning models. No person at Calm Calendar reads your data.

## Where the data is stored

All processing happens on your computer. Calm Calendar talks directly to Google's servers (`accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com`) over encrypted HTTPS connections. Nothing is sent to us or to any other third party.

The app keeps the following on your computer:

- **Sign-in token.** The Google refresh token is stored in Windows Credential Manager, protected by your Windows account. The short-lived access token is kept only in memory while the app runs.
- **Account email**, to show which account is signed in.
- **Recently loaded calendar data.** The latest calendar lists and events received from Google are saved in the app's local storage so that your calendar and the widget still show your schedule when you are offline. At most the 80 most recent responses are kept; older ones are removed automatically.
- **Settings**, such as theme, language, the widget position and which calendars are shown.

## Deleting your data

- **Sign out** in the app (the button at the bottom of the sidebar). This revokes the app's access at Google, deletes the sign-in token from Windows Credential Manager, and deletes the saved email and the saved calendar data from your computer. Your calendars themselves stay in your Google account.
- **Remove access** at any time from your Google Account: [myaccount.google.com/permissions](https://myaccount.google.com/permissions).
- **Uninstall** the app to remove its settings. If you installed it from the Microsoft Store, Windows removes the app's local data with it. For other installations you can also delete the folder `%APPDATA%\com.arseni.calmcalendar`.

## Sharing and disclosure

We do not share, sell, rent or transfer your data to anyone. Because we never receive your data, we cannot disclose it.

Calm Calendar's use and transfer of information received from Google APIs to any other app will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

## Microsoft Store and Google

If you install the app from the Microsoft Store, Microsoft handles the download, updates and any purchase under the [Microsoft Privacy Statement](https://privacy.microsoft.com/privacystatement). Your Google account and calendars are governed by the [Google Privacy Policy](https://policies.google.com/privacy).

## Children

Calm Calendar is not directed to children under 13, and we do not knowingly collect personal information from children.

## Changes to this policy

If this policy changes, the new version will be published at this address with a new effective date. Significant changes will also be mentioned in the app's release notes.

## Contact

Questions about this policy or your data: [support@calmcalendar.co.uk](mailto:support@calmcalendar.co.uk).
