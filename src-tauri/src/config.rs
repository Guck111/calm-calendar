//! Google OAuth client settings and the list of Google accounts.
//!
//! The client is taken in this order:
//! 1. build-time environment variables CALM_GOOGLE_CLIENT_ID / CALM_GOOGLE_CLIENT_SECRET
//!    (for the Microsoft Store version);
//! 2. google-client.json file in the app settings folder (for a personal build).
//!
//! A "Desktop app" client secret is not considered secret per Google's documentation;
//! the code exchange is protected by PKCE.

use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const CLIENT_FILE: &str = "google-client.json";
const LEGACY_ACCOUNT_FILE: &str = "account.json";
const ACCOUNTS_FILE: &str = "accounts.json";
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

/// Sign-in before the multi-account version: one email in account.json
#[derive(Default, Deserialize)]
struct LegacyAccount {
    email: Option<String>,
}

/// Google account; the email is also the token key in the password store
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Account {
    pub email: String,
}

/// Add an account or keep it in place if it already exists (email, case-insensitive)
pub fn with_account(mut list: Vec<Account>, email: &str) -> Vec<Account> {
    if !list.iter().any(|a| a.email.eq_ignore_ascii_case(email)) {
        list.push(Account { email: email.to_owned() });
    }
    list
}

pub fn without_account(list: Vec<Account>, email: &str) -> Vec<Account> {
    list.into_iter().filter(|a| !a.email.eq_ignore_ascii_case(email)).collect()
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

/// Accepts both the flat format { client_id, client_secret },
/// and the file downloaded from Google Cloud: { "installed": { ... } }.
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

/// Saves the client. Input is either JSON from Google Cloud or an id/secret pair.
pub fn save_client(app: &AppHandle, client_id: &str, client_secret: &str) -> Result<()> {
    let id = client_id.trim();
    let parsed = if id.starts_with('{') {
        parse_client(id).ok_or_else(|| Error::Other("Could not read the client JSON".into()))?
    } else {
        ClientConfig {
            client_id: id.to_owned(),
            client_secret: client_secret.trim().to_owned(),
        }
    };
    if !parsed.client_id.ends_with(".apps.googleusercontent.com") {
        return Err(Error::Other(
            "The client ID must end with .apps.googleusercontent.com".into(),
        ));
    }
    let path = config_dir(app)?.join(CLIENT_FILE);
    std::fs::write(path, serde_json::to_string_pretty(&parsed)?)?;
    Ok(())
}

/// Accounts in sign-in order; None — no file yet (first run or an old version)
pub fn load_accounts(app: &AppHandle) -> Option<Vec<Account>> {
    let text = std::fs::read_to_string(config_dir(app).ok()?.join(ACCOUNTS_FILE)).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn save_accounts(app: &AppHandle, accounts: &[Account]) -> Result<()> {
    let path = config_dir(app)?.join(ACCOUNTS_FILE);
    std::fs::write(path, serde_json::to_string_pretty(accounts)?)?;
    Ok(())
}

/// email from the old version's account.json. The file is not deleted: version 0.4 needs it if it is run again
pub fn legacy_email(app: &AppHandle) -> Option<String> {
    let text = std::fs::read_to_string(config_dir(app).ok()?.join(LEGACY_ACCOUNT_FILE)).ok()?;
    serde_json::from_str::<LegacyAccount>(&text).ok()?.email
}

/// Widget window settings: whether it's shown and whether it stays on top
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

/// Prominent reminder: a window on top of all windows a minute before the event starts
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AlertMode {
    #[default]
    Off,
    /// only events with a video meeting
    Calls,
    /// all timed events
    All,
}

/// Shared appearance settings
#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub glass: bool,
    pub notifications: bool,
    /// don't show the event title and location in the notification (it may be visible on the lock screen)
    pub private_notifications: bool,
    /// UI language ("ru", "en", "es"…); none — the Windows language
    pub language: Option<String>,
    pub alerts: AlertMode,
    /// system-wide Windows hotkey for quick add ("ctrl+alt+space"); None — off
    pub quick_hotkey: Option<String>,
}

/// Hotkeys to choose from in settings; the list is the same as in src/shared/lib/hotkeys.ts
pub const QUICK_HOTKEYS: [&str; 3] = ["ctrl+alt+space", "ctrl+shift+space", "alt+shift+space"];

pub fn valid_hotkey(hotkey: &str) -> bool {
    QUICK_HOTKEYS.contains(&hotkey)
}

/// In which order to try hotkeys at startup: the chosen one first, then the rest of the list.
/// The default hotkey may be taken by another program — then take the first free one
pub fn hotkey_candidates(chosen: &str) -> Vec<&'static str> {
    let first = QUICK_HOTKEYS.iter().copied().filter(|h| *h == chosen);
    first.chain(QUICK_HOTKEYS.iter().copied().filter(|h| *h != chosen)).collect()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            glass: true,
            notifications: true,
            private_notifications: false,
            language: None,
            alerts: AlertMode::Off,
            quick_hotkey: Some(QUICK_HOTKEYS[0].to_owned()),
        }
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

    #[test]
    fn old_settings_files_get_alerts_off() {
        let s: Settings = serde_json::from_str(r#"{"glass":false,"notifications":true}"#).unwrap();
        assert_eq!(s.alerts, AlertMode::Off);
        let s: Settings = serde_json::from_str(r#"{"alerts":"calls"}"#).unwrap();
        assert_eq!(s.alerts, AlertMode::Calls);
    }

    #[test]
    fn quick_hotkey_is_on_by_default_and_can_be_off() {
        let s: Settings = serde_json::from_str(r#"{"glass":true}"#).unwrap();
        assert_eq!(s.quick_hotkey.as_deref(), Some("ctrl+alt+space"));
        let s: Settings = serde_json::from_str(r#"{"quick_hotkey":null}"#).unwrap();
        assert_eq!(s.quick_hotkey, None);
        assert!(valid_hotkey("ctrl+shift+space"));
        assert!(!valid_hotkey("ctrl+alt+delete"));
    }

    #[test]
    fn hotkey_candidates_start_with_the_chosen_one() {
        assert_eq!(hotkey_candidates("ctrl+shift+space"), ["ctrl+shift+space", "ctrl+alt+space", "alt+shift+space"]);
        assert_eq!(hotkey_candidates("ctrl+alt+space"), QUICK_HOTKEYS);
        // an unknown hotkey from an old file — just the list in order
        assert_eq!(hotkey_candidates("f13"), QUICK_HOTKEYS);
    }

    #[test]
    fn accounts_are_unique_by_email() {
        let list = with_account(vec![], "me@gmail.com");
        let list = with_account(list, "Work@Company.com");
        let list = with_account(list, "ME@gmail.com");
        assert_eq!(
            list.iter().map(|a| a.email.as_str()).collect::<Vec<_>>(),
            ["me@gmail.com", "Work@Company.com"]
        );
        assert_eq!(without_account(list, "work@company.com").len(), 1);
    }

    #[test]
    fn reads_legacy_account_file() {
        let a: LegacyAccount = serde_json::from_str(r#"{"email":"me@gmail.com"}"#).unwrap();
        assert_eq!(a.email.as_deref(), Some("me@gmail.com"));
    }
}
