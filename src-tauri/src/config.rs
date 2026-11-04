//! Настройки клиента Google OAuth и сохранённый аккаунт.
//!
//! Клиент берётся в таком порядке:
//! 1. переменные окружения при сборке CALM_GOOGLE_CLIENT_ID / CALM_GOOGLE_CLIENT_SECRET
//!    (для версии в Microsoft Store);
//! 2. файл google-client.json в папке настроек приложения (для личной сборки).
//!
//! Секрет клиента типа «Desktop app» по документации Google не считается секретным,
//! защиту обмена кодом даёт PKCE.

use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const CLIENT_FILE: &str = "google-client.json";
const ACCOUNT_FILE: &str = "account.json";
const WIDGET_FILE: &str = "widget.json";
const SETTINGS_FILE: &str = "settings.json";

#[derive(Clone, Serialize, Deserialize)]
pub struct ClientConfig {
    pub client_id: String,
    pub client_secret: String,
}

#[derive(Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ClientSource {
    Build,
    File,
    None,
}

#[derive(Default, Serialize, Deserialize)]
pub struct Account {
    pub email: Option<String>,
}

fn config_dir(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| Error::Other(e.to_string()))?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn build_client() -> Option<ClientConfig> {
    match (
        option_env!("CALM_GOOGLE_CLIENT_ID"),
        option_env!("CALM_GOOGLE_CLIENT_SECRET"),
    ) {
        (Some(id), Some(secret)) if !id.is_empty() => Some(ClientConfig {
            client_id: id.to_owned(),
            client_secret: secret.to_owned(),
        }),
        _ => None,
    }
}

/// Принимает и плоский формат { client_id, client_secret },
/// и файл, скачанный из Google Cloud: { "installed": { ... } }.
fn parse_client(text: &str) -> Option<ClientConfig> {
    #[derive(Deserialize)]
    struct Downloaded {
        installed: ClientConfig,
    }
    serde_json::from_str::<ClientConfig>(text)
        .ok()
        .or_else(|| serde_json::from_str::<Downloaded>(text).ok().map(|d| d.installed))
        .filter(|c| !c.client_id.trim().is_empty())
}

fn file_client(app: &AppHandle) -> Option<ClientConfig> {
    let path = config_dir(app).ok()?.join(CLIENT_FILE);
    parse_client(&std::fs::read_to_string(path).ok()?)
}

pub fn client_source(app: &AppHandle) -> ClientSource {
    if build_client().is_some() {
        ClientSource::Build
    } else if file_client(app).is_some() {
        ClientSource::File
    } else {
        ClientSource::None
    }
}

pub fn client(app: &AppHandle) -> Result<ClientConfig> {
    build_client()
        .or_else(|| file_client(app))
        .ok_or(Error::NotConfigured)
}

/// Сохраняет клиент. На вход либо JSON из Google Cloud, либо пара id/секрет.
pub fn save_client(app: &AppHandle, client_id: &str, client_secret: &str) -> Result<()> {
    let id = client_id.trim();
    let parsed = if id.starts_with('{') {
        parse_client(id).ok_or_else(|| Error::Other("Не удалось прочитать JSON клиента".into()))?
    } else {
        ClientConfig {
            client_id: id.to_owned(),
            client_secret: client_secret.trim().to_owned(),
        }
    };
    if !parsed.client_id.ends_with(".apps.googleusercontent.com") {
        return Err(Error::Other(
            "ID клиента должен заканчиваться на .apps.googleusercontent.com".into(),
        ));
    }
    let path = config_dir(app)?.join(CLIENT_FILE);
    std::fs::write(path, serde_json::to_string_pretty(&parsed)?)?;
    Ok(())
}

pub fn load_account(app: &AppHandle) -> Account {
    config_dir(app)
        .ok()
        .and_then(|d| std::fs::read_to_string(d.join(ACCOUNT_FILE)).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub fn save_account(app: &AppHandle, account: &Account) -> Result<()> {
    let path = config_dir(app)?.join(ACCOUNT_FILE);
    std::fs::write(path, serde_json::to_string_pretty(account)?)?;
    Ok(())
}

pub fn clear_account(app: &AppHandle) {
    if let Ok(dir) = config_dir(app) {
        let _ = std::fs::remove_file(dir.join(ACCOUNT_FILE));
    }
}

/// Настройки окна-виджета: показан ли он и держится ли поверх окон
#[derive(Clone, Copy, Serialize, Deserialize)]
pub struct WidgetSettings {
    pub visible: bool,
    pub on_top: bool,
}

impl Default for WidgetSettings {
    fn default() -> Self {
        Self { visible: true, on_top: false }
    }
}

pub fn load_widget(app: &AppHandle) -> WidgetSettings {
    config_dir(app)
        .ok()
        .and_then(|d| std::fs::read_to_string(d.join(WIDGET_FILE)).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub fn save_widget(app: &AppHandle, settings: WidgetSettings) {
    if let Ok(dir) = config_dir(app) {
        if let Ok(text) = serde_json::to_string_pretty(&settings) {
            let _ = std::fs::write(dir.join(WIDGET_FILE), text);
        }
    }
}

/// Общие настройки оформления
#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub glass: bool,
    pub notifications: bool,
    /// не показывать название и место события в уведомлении (оно бывает видно на экране блокировки)
    pub private_notifications: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self { glass: true, notifications: true, private_notifications: false }
    }
}

pub fn load_settings(app: &AppHandle) -> Settings {
    config_dir(app)
        .ok()
        .and_then(|d| std::fs::read_to_string(d.join(SETTINGS_FILE)).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub fn save_settings(app: &AppHandle, settings: Settings) -> Result<()> {
    let path = config_dir(app)?.join(SETTINGS_FILE);
    std::fs::write(path, serde_json::to_string_pretty(&settings)?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_both_client_formats() {
        let flat = r#"{"client_id":"x.apps.googleusercontent.com","client_secret":"s"}"#;
        let downloaded = r#"{"installed":{"client_id":"x.apps.googleusercontent.com","client_secret":"s","auth_uri":"u"}}"#;
        assert_eq!(parse_client(flat).unwrap().client_secret, "s");
        assert_eq!(parse_client(downloaded).unwrap().client_id, "x.apps.googleusercontent.com");
        assert!(parse_client(r#"{"client_id":" ","client_secret":""}"#).is_none());
    }
}
