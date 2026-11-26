//! Event reminders. The UI sends the schedule (reminder times
//! from Google Calendar), and the Rust side shows the notifications: Windows may throttle timers in a hidden
//! window.

use crate::config::AlertMode;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::{Mutex, Notify};

#[derive(Clone, Deserialize, Serialize)]
pub struct Reminder {
    /// unique for the "event + reminder" pair, so it isn't shown twice
    pub key: String,
    pub title: String,
    pub body: String,
    /// title and text without the event title and location — for the "hide titles" mode
    #[serde(default)]
    pub private_title: Option<String>,
    #[serde(default)]
    pub private_body: Option<String>,
    /// show time, Unix milliseconds
    pub at: i64,
    /// video meeting link and the "Join" button label in the UI language
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub join_label: Option<String>,
    /// prominent reminder: a window on top of all windows instead of a notification
    #[serde(default)]
    pub alert: bool,
    /// event start and end, Unix milliseconds: the reminder window writes "in 1 min" itself
    #[serde(default)]
    pub start: i64,
    #[serde(default)]
    pub end: i64,
    /// video meeting service: Google Meet, Zoom…
    #[serde(default)]
    pub provider: Option<String>,
    /// snoozed copy: the person asked to be reminded again, the setting is not checked
    #[serde(skip)]
    pub snoozed: bool,
}

#[derive(Default)]
pub struct Reminders {
    items: Mutex<Vec<Reminder>>,
    /// snoozed prominent reminders: a new schedule from the UI doesn't erase them
    snoozed: Mutex<Vec<Reminder>>,
    /// prominent reminders currently in the window on top of all windows
    open: Mutex<Vec<Reminder>>,
    shown: Mutex<HashSet<String>>,
    changed: Notify,
}

/// a reminder late by more than this (the computer was asleep) is no longer shown
const LATE_LIMIT_MS: i64 = 5 * 60_000;
/// even without changes wake up once a minute: the clock may have shifted after sleep
const MAX_SLEEP: Duration = Duration::from_secs(60);

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Whether to show this prominent reminder with this setting
pub fn alert_allowed(mode: AlertMode, r: &Reminder) -> bool {
    match mode {
        AlertMode::Off => false,
        AlertMode::Calls => r.url.is_some(),
        AlertMode::All => true,
    }
}

/// Snoozed copy: a new key so it is shown again
fn snoozed_copy(r: &Reminder, now: i64, minutes: i64) -> Reminder {
    let at = now + minutes * 60_000;
    Reminder { key: format!("{}|snooze|{at}", r.key), at, snoozed: true, ..r.clone() }
}

impl Reminders {
    pub async fn replace(&self, items: Vec<Reminder>) {
        *self.items.lock().await = items;
        self.changed.notify_one();
    }

    /// Notifications turned off: only prominent reminders remain, they have their own setting
    pub async fn keep_alerts_only(&self) {
        self.items.lock().await.retain(|r| r.alert);
        self.changed.notify_one();
    }

    pub async fn open_alerts(&self) -> Vec<Reminder> {
        self.open.lock().await.clone()
    }

    /// Close a reminder; true — no more open ones
    pub async fn dismiss(&self, key: &str) -> bool {
        let mut open = self.open.lock().await;
        open.retain(|r| r.key != key);
        open.is_empty()
    }

    /// The window was closed entirely (Alt+F4): all open reminders count as closed
    pub async fn dismiss_all(&self) {
        self.open.lock().await.clear();
    }

    /// Snooze for minutes minutes; true — no more open ones
    pub async fn snooze(&self, key: &str, minutes: i64) -> bool {
        let mut open = self.open.lock().await;
        if let Some(pos) = open.iter().position(|r| r.key == key) {
            let r = open.remove(pos);
            self.snoozed.lock().await.push(snoozed_copy(&r, now_ms(), minutes));
            self.changed.notify_one();
        }
        open.is_empty()
    }

    /// Marks due reminders as shown and puts new prominent ones into the open list
    async fn take_due(&self, now: i64, mode: AlertMode) -> Pass {
        let mut items = self.items.lock().await.clone();
        items.extend(self.snoozed.lock().await.iter().cloned());
        let mut notifications = Vec::new();
        let mut new_alerts = Vec::new();
        {
            let mut shown = self.shown.lock().await;
            for r in items.iter().filter(|r| r.at <= now) {
                if !shown.insert(r.key.clone()) || now - r.at > LATE_LIMIT_MS {
                    continue;
                }
                if !r.alert {
                    notifications.push(r.clone());
                } else if r.snoozed || alert_allowed(mode, r) {
                    new_alerts.push(r.clone());
                }
            }
            // snoozed ones are shown once; so the set doesn't grow forever,
            // forget keys that are not in the schedule
            self.snoozed.lock().await.retain(|r| r.at > now);
            let keys: HashSet<&String> = items.iter().map(|r| &r.key).collect();
            shown.retain(|k| keys.contains(k));
        }
        let alerted = !new_alerts.is_empty();
        let mut open = self.open.lock().await;
        for r in new_alerts {
            if !open.iter().any(|o| o.key == r.key) {
                open.push(r);
            }
        }
        Pass { notifications, alerted, next: items.iter().filter(|r| r.at > now).map(|r| r.at).min() }
    }

    async fn fire_due(&self, app: &AppHandle) -> Option<i64> {
        let settings = crate::config::load_settings(app);
        let pass = self.take_due(now_ms(), settings.alerts).await;
        for r in &pass.notifications {
            let (title, body) = notification_text(r, settings.private_notifications);
            if !show_with_link(app, r, title, body) {
                let _ = app.notification().builder().title(title).body(body).show();
            }
        }
        if pass.alerted {
            crate::desktop::show_alert(app);
        }
        pass.next
    }
}

/// One scheduler pass: notifications to show now, whether the prominent reminder window is needed, the next reminder time
struct Pass {
    notifications: Vec<Reminder>,
    alerted: bool,
    next: Option<i64>,
}

/// In the "hide titles" mode the notification has no event title and location
fn notification_text(r: &Reminder, private: bool) -> (&str, &str) {
    if private {
        (r.private_title.as_deref().unwrap_or("Calm Calendar"), r.private_body.as_deref().unwrap_or(""))
    } else {
        (r.title.as_str(), r.body.as_str())
    }
}

/// How long the scheduler sleeps: until the next reminder, but no longer than MAX_SLEEP
fn sleep_time(next: Option<i64>, now: i64) -> Duration {
    next.map(|at| Duration::from_millis((at - now).max(0) as u64)).unwrap_or(MAX_SLEEP).min(MAX_SLEEP)
}

/// A notification with a "Join" button if the event has a video meeting. false — show a regular one
#[cfg(windows)]
fn show_with_link(app: &AppHandle, r: &Reminder, title: &str, body: &str) -> bool {
    let (Some(url), Some(label)) = (&r.url, &r.join_label) else { return false };
    let identifier = &app.config().identifier;
    crate::toast::show_with_link(identifier, title, body, label, url).is_ok()
}

#[cfg(not(windows))]
fn show_with_link(_: &AppHandle, _: &Reminder, _: &str, _: &str) -> bool {
    false
}

/// Development build only: `CALM_DEMO_ALERT=1 npx tauri dev` immediately shows the
/// prominent reminder window with a sample, to check it without an event in Google
#[cfg(debug_assertions)]
async fn demo_alert(app: &AppHandle) {
    if std::env::var_os("CALM_DEMO_ALERT").is_none() {
        return;
    }
    let start = now_ms() + 60_000;
    let demo = Reminder {
        key: "demo".into(),
        title: "Design sync".into(),
        body: String::new(),
        private_title: None,
        private_body: None,
        at: now_ms(),
        url: Some("https://calmcalendar.co.uk/".into()),
        join_label: None,
        alert: true,
        start,
        end: start + 30 * 60_000,
        provider: Some("Google Meet".into()),
        snoozed: false,
    };
    app.state::<Reminders>().open.lock().await.push(demo);
    crate::desktop::show_alert(app);
    log::info!("demo alert shown");
}

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        #[cfg(debug_assertions)]
        demo_alert(&app).await;
        loop {
            let state = app.state::<Reminders>();
            let next = state.fire_due(&app).await;
            let wait = sleep_time(next, now_ms());
            tokio::select! {
                _ = tokio::time::sleep(wait) => {}
                _ = state.changed.notified() => {}
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(key: &str, at: i64) -> Reminder {
        Reminder {
            key: key.into(),
            title: String::new(),
            body: String::new(),
            private_title: None,
            private_body: None,
            at,
            url: None,
            join_label: None,
            alert: false,
            start: 0,
            end: 0,
            provider: None,
            snoozed: false,
        }
    }

    #[test]
    fn deserializes_from_frontend_shape() {
        let v: Vec<Reminder> =
            serde_json::from_str(r#"[{"key":"a","title":"t","body":"b","at":1700000000000}]"#).unwrap();
        assert_eq!(v[0].at, 1_700_000_000_000);
        assert_eq!(v[0].url, None);
        let with_link: Vec<Reminder> = serde_json::from_str(
            r#"[{"key":"a","title":"t","body":"b","at":1,"url":"https://meet.google.com/abc-defg-hij","join_label":"Join"}]"#,
        )
        .unwrap();
        assert_eq!(with_link[0].join_label.as_deref(), Some("Join"));
        let _ = r("x", 0);
    }

    #[test]
    fn alert_mode_filters_by_video_call() {
        let plain = Reminder { alert: true, ..r("a", 0) };
        let call = Reminder { url: Some("https://meet.google.com/abc-defg-hij".into()), ..plain.clone() };
        assert!(!alert_allowed(AlertMode::Off, &call));
        assert!(alert_allowed(AlertMode::Calls, &call));
        assert!(!alert_allowed(AlertMode::Calls, &plain));
        assert!(alert_allowed(AlertMode::All, &plain));
    }

    #[test]
    fn snoozed_copy_gets_a_new_key_and_time() {
        let copy = snoozed_copy(&Reminder { alert: true, ..r("a", 0) }, 1_000, 5);
        assert_eq!(copy.at, 301_000);
        assert_ne!(copy.key, "a");
        assert!(copy.alert);
        assert!(copy.snoozed);
    }

    #[test]
    fn snooze_and_dismiss_report_when_nothing_is_open() {
        tauri::async_runtime::block_on(async {
            let state = Reminders::default();
            state.open.lock().await.extend([r("a", 0), r("b", 0)]);
            assert!(!state.snooze("a", 5).await);
            assert_eq!(state.snoozed.lock().await.len(), 1);
            assert!(state.dismiss("b").await);
        });
    }

    const MIN: i64 = 60_000;

    fn alert(key: &str, at: i64) -> Reminder {
        Reminder { alert: true, url: Some("https://meet.google.com/abc-defg-hij".into()), ..r(key, at) }
    }

    fn keys(list: &[Reminder]) -> Vec<&str> {
        list.iter().map(|r| r.key.as_str()).collect()
    }

    async fn open_keys(state: &Reminders) -> Vec<String> {
        state.open_alerts().await.into_iter().map(|r| r.key).collect()
    }

    #[tokio::test]
    async fn due_reminder_is_shown_once_and_the_next_one_sets_the_wake_up() {
        let state = Reminders::default();
        state.replace(vec![r("now", 10 * MIN), r("later", 20 * MIN), r("soon", 15 * MIN)]).await;
        let pass = state.take_due(10 * MIN, AlertMode::Off).await;
        assert_eq!(keys(&pass.notifications), ["now"]);
        assert!(!pass.alerted);
        assert_eq!(pass.next, Some(15 * MIN));
        let again = state.take_due(11 * MIN, AlertMode::Off).await;
        assert!(again.notifications.is_empty());
    }

    #[tokio::test]
    async fn nothing_ahead_leaves_no_wake_up_time() {
        let state = Reminders::default();
        state.replace(vec![r("past", MIN)]).await;
        assert_eq!(state.take_due(2 * MIN, AlertMode::Off).await.next, None);
    }

    #[tokio::test]
    async fn reminder_late_after_sleep_is_skipped_for_good() {
        let state = Reminders::default();
        state.replace(vec![r("on_limit", 0), r("too_late", -1)]).await;
        let pass = state.take_due(LATE_LIMIT_MS, AlertMode::Off).await;
        assert_eq!(keys(&pass.notifications), ["on_limit"]);
        assert!(state.shown.lock().await.contains("too_late"));
    }

    #[tokio::test]
    async fn reminder_up_to_five_minutes_late_is_still_shown() {
        let state = Reminders::default();
        state.replace(vec![r("four", 0), r("six", -2 * MIN)]).await;
        let pass = state.take_due(4 * MIN, AlertMode::Off).await;
        assert_eq!(keys(&pass.notifications), ["four"]);
    }

    #[tokio::test]
    async fn reminder_returning_to_the_schedule_is_shown_again() {
        let state = Reminders::default();
        state.replace(vec![r("a", 0)]).await;
        state.take_due(0, AlertMode::Off).await;
        state.replace(vec![]).await;
        state.take_due(MIN, AlertMode::Off).await;
        state.replace(vec![r("a", MIN)]).await;
        assert_eq!(keys(&state.take_due(MIN, AlertMode::Off).await.notifications), ["a"]);
    }

    #[tokio::test]
    async fn prominent_reminder_opens_the_window_only_when_the_setting_allows() {
        let state = Reminders::default();
        state.replace(vec![alert("call", 0), Reminder { url: None, ..alert("plain", 0) }]).await;
        let pass = state.take_due(0, AlertMode::Calls).await;
        assert!(pass.notifications.is_empty());
        assert!(pass.alerted);
        assert_eq!(open_keys(&state).await, ["call"]);

        let off = Reminders::default();
        off.replace(vec![alert("call", 0)]).await;
        assert!(!off.take_due(0, AlertMode::Off).await.alerted);
        assert!(off.open_alerts().await.is_empty());
    }

    #[tokio::test]
    async fn snoozed_reminder_comes_back_once_whatever_the_setting() {
        let state = Reminders::default();
        state.open.lock().await.push(alert("call", 0));
        state.snooze("call", 5).await;
        let at = state.snoozed.lock().await[0].at;
        state.replace(vec![]).await;
        assert_eq!(state.take_due(at - 1, AlertMode::Off).await.next, Some(at));
        assert!(state.take_due(at, AlertMode::Off).await.alerted);
        assert_eq!(state.open_alerts().await.len(), 1);
        assert!(state.snoozed.lock().await.is_empty());
    }

    #[tokio::test]
    async fn already_open_reminder_is_not_added_twice() {
        let state = Reminders::default();
        state.open.lock().await.push(alert("call", 0));
        state.replace(vec![alert("call", 0)]).await;
        state.take_due(0, AlertMode::All).await;
        assert_eq!(open_keys(&state).await, ["call"]);
    }

    #[tokio::test]
    async fn turning_notifications_off_keeps_only_prominent_reminders() {
        let state = Reminders::default();
        state.replace(vec![r("plain", MIN), alert("call", MIN)]).await;
        state.keep_alerts_only().await;
        assert_eq!(keys(&state.items.lock().await), ["call"]);
    }

    #[tokio::test]
    async fn closing_the_window_closes_every_reminder() {
        let state = Reminders::default();
        state.open.lock().await.extend([alert("a", 0), alert("b", 0)]);
        assert!(!state.dismiss("a").await);
        assert_eq!(open_keys(&state).await, ["b"]);
        state.dismiss_all().await;
        assert!(state.open_alerts().await.is_empty());
    }

    #[tokio::test]
    async fn snoozing_an_unknown_reminder_changes_nothing() {
        let state = Reminders::default();
        state.open.lock().await.push(alert("a", 0));
        assert!(!state.snooze("gone", 5).await);
        assert!(state.snoozed.lock().await.is_empty());
    }

    #[test]
    fn private_mode_hides_the_event_title() {
        let rem = Reminder { title: "Doctor".into(), body: "Clinic".into(), ..r("a", 0) };
        assert_eq!(notification_text(&rem, false), ("Doctor", "Clinic"));
        assert_eq!(notification_text(&rem, true), ("Calm Calendar", ""));
        let with_private = Reminder { private_title: Some("Event".into()), private_body: Some("in 5 min".into()), ..rem };
        assert_eq!(notification_text(&with_private, true), ("Event", "in 5 min"));
    }

    #[test]
    fn scheduler_sleeps_until_the_next_reminder_but_at_most_a_minute() {
        assert_eq!(sleep_time(Some(10_500), 10_000), Duration::from_millis(500));
        assert_eq!(sleep_time(Some(9_000), 10_000), Duration::ZERO);
        assert_eq!(sleep_time(Some(10 * MIN), 0), MAX_SLEEP);
        assert_eq!(sleep_time(None, 0), MAX_SLEEP);
    }
}
