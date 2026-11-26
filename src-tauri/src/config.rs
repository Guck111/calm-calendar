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
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::path::{Path, PathBuf};
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

fn read_json<T: DeserializeOwned>(dir: &Path, file: &str) -> Option<T> {
    serde_json::from_str(&std::fs::read_to_string(dir.join(file)).ok()?).ok()
}

fn write_json<T: Serialize + ?Sized>(dir: &Path, file: &str, value: &T) -> Result<()> {
    std::fs::write(dir.join(file), serde_json::to_string_pretty(value)?)?;
    Ok(())
}

fn build_client() -> Option<ClientConfig> {
    client_from_build(option_env!("CALM_GOOGLE_CLIENT_ID"), option_env!("CALM_GOOGLE_CLIENT_SECRET"))
}

fn client_from_build(id: Option<&str>, secret: Option<&str>) -> Option<ClientConfig> {
    match (id, secret) {
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
    read_client(&config_dir(app).ok()?)
}

fn read_client(dir: &Path) -> Option<ClientConfig> {
    parse_client(&std::fs::read_to_string(dir.join(CLIENT_FILE)).ok()?)
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
    let client = client_from_input(client_id, client_secret)?;
    write_json(&config_dir(app)?, CLIENT_FILE, &client)
}

fn client_from_input(client_id: &str, client_secret: &str) -> Result<ClientConfig> {
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
    Ok(parsed)
}

/// Accounts in sign-in order; None — no file yet (first run or an old version)
pub fn load_accounts(app: &AppHandle) -> Option<Vec<Account>> {
    read_json(&config_dir(app).ok()?, ACCOUNTS_FILE)
}

pub fn save_accounts(app: &AppHandle, accounts: &[Account]) -> Result<()> {
    write_json(&config_dir(app)?, ACCOUNTS_FILE, accounts)
}

/// email from the old version's account.json. The file is not deleted: version 0.4 needs it if it is run again
pub fn legacy_email(app: &AppHandle) -> Option<String> {
    read_legacy_email(&config_dir(app).ok()?)
}

fn read_legacy_email(dir: &Path) -> Option<String> {
    read_json::<LegacyAccount>(dir, LEGACY_ACCOUNT_FILE)?.email
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
    config_dir(app).ok().and_then(|d| read_json(&d, WIDGET_FILE)).unwrap_or_default()
}

pub fn save_widget(app: &AppHandle, settings: WidgetSettings) {
    let _ = config_dir(app).and_then(|d| write_json(&d, WIDGET_FILE, &settings));
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
    config_dir(app).ok().and_then(|d| read_json(&d, SETTINGS_FILE)).unwrap_or_default()
}

pub fn save_settings(app: &AppHandle, settings: Settings) -> Result<()> {
    write_json(&config_dir(app)?, SETTINGS_FILE, &settings)
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
        assert_eq!(without_account(list, "work@company.com"), [Account { email: "me@gmail.com".into() }]);
    }

    #[test]
    fn reads_legacy_account_file() {
        let a: LegacyAccount = serde_json::from_str(r#"{"email":"me@gmail.com"}"#).unwrap();
        assert_eq!(a.email.as_deref(), Some("me@gmail.com"));
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("calm-calendar-config-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn saved_files_are_read_back() {
        let dir = temp_dir("round-trip");
        let accounts = vec![Account { email: "me@gmail.com".into() }];
        write_json(&dir, ACCOUNTS_FILE, &accounts).unwrap();
        assert_eq!(read_json::<Vec<Account>>(&dir, ACCOUNTS_FILE), Some(accounts));
        let settings = Settings { alerts: AlertMode::All, ..Settings::default() };
        write_json(&dir, SETTINGS_FILE, &settings).unwrap();
        assert_eq!(read_json::<Settings>(&dir, SETTINGS_FILE).unwrap().alerts, AlertMode::All);
    }

    #[test]
    fn missing_or_broken_file_reads_as_nothing() {
        let dir = temp_dir("broken");
        assert!(read_json::<Vec<Account>>(&dir, ACCOUNTS_FILE).is_none());
        std::fs::write(dir.join(ACCOUNTS_FILE), "{not json").unwrap();
        assert!(read_json::<Vec<Account>>(&dir, ACCOUNTS_FILE).is_none());
        assert!(write_json(&dir.join("missing"), ACCOUNTS_FILE, &[0]).is_err());
    }

    #[test]
    fn reads_the_old_versions_email_and_client_files() {
        let dir = temp_dir("legacy");
        assert_eq!(read_legacy_email(&dir), None);
        assert!(read_client(&dir).is_none());
        std::fs::write(dir.join(LEGACY_ACCOUNT_FILE), r#"{"email":"me@gmail.com"}"#).unwrap();
        std::fs::write(dir.join(CLIENT_FILE), r#"{"installed":{"client_id":"x.apps.googleusercontent.com","client_secret":"s"}}"#).unwrap();
        assert_eq!(read_legacy_email(&dir).as_deref(), Some("me@gmail.com"));
        assert_eq!(read_client(&dir).unwrap().client_id, "x.apps.googleusercontent.com");
    }

    #[test]
    fn client_typed_by_hand_is_trimmed_and_checked() {
        let c = client_from_input(" x.apps.googleusercontent.com ", " s ").unwrap();
        assert_eq!((c.client_id.as_str(), c.client_secret.as_str()), ("x.apps.googleusercontent.com", "s"));
        assert!(client_from_input("x.example.com", "s").is_err());
    }

    #[test]
    fn client_json_can_be_pasted_into_the_id_field() {
        let pasted = r#" {"installed":{"client_id":"x.apps.googleusercontent.com","client_secret":"s"}}"#;
        assert_eq!(client_from_input(pasted, "").unwrap().client_secret, "s");
        assert!(client_from_input("{broken", "").is_err());
        assert!(client_from_input(r#"{"client_id":"x.example.com","client_secret":"s"}"#, "").is_err());
    }

    #[test]
    fn build_client_needs_a_non_empty_id() {
        let c = client_from_build(Some("x.apps.googleusercontent.com"), Some("s")).unwrap();
        assert_eq!((c.client_id.as_str(), c.client_secret.as_str()), ("x.apps.googleusercontent.com", "s"));
        assert!(client_from_build(Some(""), Some("s")).is_none());
        assert!(client_from_build(Some("x"), None).is_none());
        assert!(client_from_build(None, None).is_none());
    }

    #[test]
    fn first_run_defaults() {
        let w = WidgetSettings::default();
        assert!(w.visible && !w.on_top);
        let s: Settings = serde_json::from_str("{}").unwrap();
        assert!(s.glass && s.notifications && !s.private_notifications);
        assert_eq!(s.language, None);
        assert_eq!(s.alerts, AlertMode::Off);
    }
}
