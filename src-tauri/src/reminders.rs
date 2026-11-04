//! Напоминания о событиях. Расписание присылает интерфейс (время напоминаний
//! из Google Календаря), а показывает уведомления Rust-часть: таймеры в скрытом
//! окне Windows может притормаживать.

use serde::Deserialize;
use std::collections::HashSet;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::{Mutex, Notify};

#[derive(Clone, Deserialize)]
pub struct Reminder {
    /// уникален для пары «событие + напоминание», чтобы не показать дважды
    pub key: String,
    pub title: String,
    pub body: String,
    /// текст без названия и места — для режима «скрывать названия»
    #[serde(default)]
    pub private_body: Option<String>,
    /// момент показа, миллисекунды Unix
    pub at: i64,
}

#[derive(Default)]
pub struct Reminders {
    items: Mutex<Vec<Reminder>>,
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

impl Reminders {
    pub async fn replace(&self, items: Vec<Reminder>) {
        *self.items.lock().await = items;
        self.changed.notify_one();
    }

    async fn fire_due(&self, app: &AppHandle) -> Option<i64> {
        let now = now_ms();
        let items = self.items.lock().await.clone();
        let private = crate::config::load_settings(app).private_notifications;
        let mut shown = self.shown.lock().await;
        let due: Vec<&Reminder> = items.iter().filter(|r| r.at <= now && !shown.contains(&r.key)).collect();
        for r in due {
            shown.insert(r.key.clone());
            if now - r.at <= LATE_LIMIT_MS {
                let (title, body) = if private {
                    ("Событие", r.private_body.as_deref().unwrap_or("Скоро начнётся"))
                } else {
                    (r.title.as_str(), r.body.as_str())
                };
                let _ = app.notification().builder().title(title).body(body).show();
            }
        }
        // чтобы множество не росло бесконечно, забываем ключи, которых нет в расписании
        let keys: HashSet<&String> = items.iter().map(|r| &r.key).collect();
        shown.retain(|k| keys.contains(k));
        items.iter().filter(|r| r.at > now).map(|r| r.at).min()
    }
}

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
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
        Reminder { key: key.into(), title: String::new(), body: String::new(), private_body: None, at }
    }

    #[test]
    fn deserializes_from_frontend_shape() {
        let v: Vec<Reminder> =
            serde_json::from_str(r#"[{"key":"a","title":"t","body":"b","at":1700000000000}]"#).unwrap();
        assert_eq!(v[0].at, 1_700_000_000_000);
        let _ = r("x", 0);
    }
}
