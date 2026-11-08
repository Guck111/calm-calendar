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
                    (r.private_title.as_deref().unwrap_or("Calm Calendar"), r.private_body.as_deref().unwrap_or(""))
                } else {
                    (r.title.as_str(), r.body.as_str())
                };
                if !show_with_link(app, r, title, body) {
                    let _ = app.notification().builder().title(title).body(body).show();
                }
            }
        }
        // чтобы множество не росло бесконечно, забываем ключи, которых нет в расписании
        let keys: HashSet<&String> = items.iter().map(|r| &r.key).collect();
        shown.retain(|k| keys.contains(k));
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
        Reminder {
            key: key.into(),
            title: String::new(),
            body: String::new(),
            private_title: None,
            private_body: None,
            at,
            url: None,
            join_label: None,
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
}
