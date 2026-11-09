//! Напоминания о событиях. Расписание присылает интерфейс (время напоминаний
//! из Google Календаря), а показывает уведомления Rust-часть: таймеры в скрытом
//! окне Windows может притормаживать.

use crate::config::AlertMode;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::{Mutex, Notify};

#[derive(Clone, Deserialize, Serialize)]
pub struct Reminder {
    /// уникален для пары «событие + напоминание», чтобы не показать дважды
    pub key: String,
    pub title: String,
    pub body: String,
    /// заголовок и текст без названия и места — для режима «скрывать названия»
    #[serde(default)]
    pub private_title: Option<String>,
    #[serde(default)]
    pub private_body: Option<String>,
    /// момент показа, миллисекунды Unix
    pub at: i64,
    /// ссылка на видеовстречу и подпись кнопки «Подключиться» на языке интерфейса
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub join_label: Option<String>,
    /// заметное напоминание: окно поверх всех окон вместо уведомления
    #[serde(default)]
    pub alert: bool,
    /// начало и конец события, миллисекунды Unix: окно напоминания пишет «через 1 мин» само
    #[serde(default)]
    pub start: i64,
    #[serde(default)]
    pub end: i64,
    /// сервис видеовстречи: Google Meet, Zoom…
    #[serde(default)]
    pub provider: Option<String>,
    /// отложенная копия: человек сам попросил напомнить снова, настройку не проверяем
    #[serde(skip)]
    pub snoozed: bool,
}

#[derive(Default)]
pub struct Reminders {
    items: Mutex<Vec<Reminder>>,
    /// отложенные заметные напоминания: новое расписание из интерфейса их не стирает
    snoozed: Mutex<Vec<Reminder>>,
    /// заметные напоминания, которые сейчас в окне поверх всех окон
    open: Mutex<Vec<Reminder>>,
    shown: Mutex<HashSet<String>>,
    changed: Notify,
}

/// напоминание, опоздавшее больше чем на это время (компьютер спал), уже не показываем
const LATE_LIMIT_MS: i64 = 5 * 60_000;
/// даже без изменений просыпаемся раз в минуту: часы могли сдвинуться после сна
const MAX_SLEEP: Duration = Duration::from_secs(60);

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Показывать ли это заметное напоминание при такой настройке
pub fn alert_allowed(mode: AlertMode, r: &Reminder) -> bool {
    match mode {
        AlertMode::Off => false,
        AlertMode::Calls => r.url.is_some(),
        AlertMode::All => true,
    }
}

/// Отложенная копия: новый ключ, чтобы её показали ещё раз
fn snoozed_copy(r: &Reminder, now: i64, minutes: i64) -> Reminder {
    let at = now + minutes * 60_000;
    Reminder { key: format!("{}|snooze|{at}", r.key), at, snoozed: true, ..r.clone() }
}

impl Reminders {
    pub async fn replace(&self, items: Vec<Reminder>) {
        *self.items.lock().await = items;
        self.changed.notify_one();
    }

    /// Уведомления выключили: остаются только заметные напоминания, у них своя настройка
    pub async fn keep_alerts_only(&self) {
        self.items.lock().await.retain(|r| r.alert);
        self.changed.notify_one();
    }

    pub async fn open_alerts(&self) -> Vec<Reminder> {
        self.open.lock().await.clone()
    }

    /// Закрыть напоминание; true — больше открытых нет
    pub async fn dismiss(&self, key: &str) -> bool {
        let mut open = self.open.lock().await;
        open.retain(|r| r.key != key);
        open.is_empty()
    }

    /// Окно закрыли целиком (Alt+F4): все открытые напоминания считаются закрытыми
    pub async fn dismiss_all(&self) {
        self.open.lock().await.clear();
    }

    /// Отложить на minutes минут; true — больше открытых нет
    pub async fn snooze(&self, key: &str, minutes: i64) -> bool {
        let mut open = self.open.lock().await;
        if let Some(pos) = open.iter().position(|r| r.key == key) {
            let r = open.remove(pos);
            self.snoozed.lock().await.push(snoozed_copy(&r, now_ms(), minutes));
            self.changed.notify_one();
        }
        open.is_empty()
    }

    async fn fire_due(&self, app: &AppHandle) -> Option<i64> {
        let now = now_ms();
        let mut items = self.items.lock().await.clone();
        items.extend(self.snoozed.lock().await.iter().cloned());
        let settings = crate::config::load_settings(app);
        let mut new_alerts = Vec::new();
        {
            let mut shown = self.shown.lock().await;
            let due: Vec<&Reminder> = items.iter().filter(|r| r.at <= now && !shown.contains(&r.key)).collect();
            for r in due {
                shown.insert(r.key.clone());
                if now - r.at > LATE_LIMIT_MS {
                    continue;
                }
                if r.alert {
                    if r.snoozed || alert_allowed(settings.alerts, r) {
                        new_alerts.push(r.clone());
                    }
                    continue;
                }
                let (title, body) = if settings.private_notifications {
                    (r.private_title.as_deref().unwrap_or("Calm Calendar"), r.private_body.as_deref().unwrap_or(""))
                } else {
                    (r.title.as_str(), r.body.as_str())
                };
                if !show_with_link(app, r, title, body) {
                    let _ = app.notification().builder().title(title).body(body).show();
                }
            }
            // отложенные показываются один раз; чтобы множество не росло бесконечно,
            // забываем ключи, которых нет в расписании
            self.snoozed.lock().await.retain(|r| r.at > now);
            let keys: HashSet<&String> = items.iter().map(|r| &r.key).collect();
            shown.retain(|k| keys.contains(k));
        }
        if !new_alerts.is_empty() {
            {
                let mut open = self.open.lock().await;
                for r in new_alerts {
                    if !open.iter().any(|o| o.key == r.key) {
                        open.push(r);
                    }
                }
            }
            crate::desktop::show_alert(app);
        }
        items.iter().filter(|r| r.at > now).map(|r| r.at).min()
    }
}

/// Уведомление с кнопкой «Подключиться», если у события есть видеовстреча. false — показать обычное
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

/// Только в сборке для разработки: `CALM_DEMO_ALERT=1 npx tauri dev` сразу показывает окно
/// заметного напоминания с примером, чтобы проверить его без события в Google
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
    eprintln!("demo alert shown");
}

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        #[cfg(debug_assertions)]
        demo_alert(&app).await;
        loop {
            let state = app.state::<Reminders>();
            let next = state.fire_due(&app).await;
            let wait = next
                .map(|at| Duration::from_millis((at - now_ms()).max(0) as u64))
                .unwrap_or(MAX_SLEEP)
                .min(MAX_SLEEP);
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
}
