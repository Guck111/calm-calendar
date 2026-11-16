// Work log: a file in the app's log folder (%LOCALAPPDATA%\<id>\logs), to investigate failures
// on users' machines. The log doesn't get tokens, event titles or descriptions; email only as "a***@gmail.com".
use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};
use tauri_plugin_opener::OpenerExt;

use crate::error::{Error, Result};

/// log file name without extension
const FILE_NAME: &str = "calm-calendar";
/// size of one file; old files are renamed with a date, the last few are kept
const MAX_FILE_SIZE: u128 = 1_000_000;
const KEEP_FILES: usize = 5;

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    // verbose records — only from the app's code and only in a debug build; libraries get warnings
    // and errors: their debug lines may contain personal data (keyring writes the email in the entry name)
    let own = if cfg!(debug_assertions) { log::LevelFilter::Debug } else { log::LevelFilter::Info };
    tauri_plugin_log::Builder::new()
        .clear_targets()
        .targets([
            Target::new(TargetKind::LogDir { file_name: Some(FILE_NAME.into()) }),
            Target::new(TargetKind::Stdout),
        ])
        .level(log::LevelFilter::Warn)
        .level_for(env!("CARGO_CRATE_NAME"), own)
        // window messages (log_message) come with target "ui"
        .level_for("ui", log::LevelFilter::Info)
        .max_file_size(MAX_FILE_SIZE)
        .rotation_strategy(RotationStrategy::KeepSome(KEEP_FILES))
        .timezone_strategy(TimezoneStrategy::UseLocal)
        .build()
}

/// A panic in a release build closes the app (panic = "abort"); before that we manage to write it to the log
pub fn install_panic_hook() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!("panic: {info}");
        default(info);
    }));
}

/// "a***@gmail.com": the log shows which account it is, but not the address itself
pub fn mask(email: &str) -> String {
    match email.split_once('@') {
        Some((name, domain)) => {
            let first: String = name.chars().take(1).collect();
            format!("{first}***@{domain}")
        }
        None if email.is_empty() => String::new(),
        None => "***".into(),
    }
}

/// Google request path without calendar and event ids: "calendars/…/events/…/instances"
pub fn path_shape(path: &str) -> String {
    let mut out = Vec::new();
    let mut hide_next = false;
    for part in path.trim_start_matches('/').split('/') {
        if hide_next {
            out.push("…");
            hide_next = false;
            continue;
        }
        hide_next = matches!(part, "calendars" | "events" | "calendarList");
        out.push(part);
    }
    out.join("/")
}

/// Message from the UI: windows write their own errors to the log
pub fn from_ui(level: &str, window: &str, message: &str) {
    // a string from the UI can be long (call stack): limit it
    let text: String = message.chars().take(4000).collect();
    match level {
        "error" => log::error!(target: "ui", "[{window}] {text}"),
        "warn" => log::warn!(target: "ui", "[{window}] {text}"),
        _ => log::info!(target: "ui", "[{window}] {text}"),
    }
}

/// Open the log folder in Explorer
pub fn open_folder(app: &AppHandle) -> Result<()> {
    let dir = app.path().app_log_dir().map_err(|e| Error::Other(e.to_string()))?;
    std::fs::create_dir_all(&dir)?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| Error::Other(format!("Could not open the logs folder: {e}")))
}

/// Command error record: the error kind and text without personal data
pub fn command_failed(what: &str, e: &Error) {
    match e {
        // sign-in expired is normal, the UI will offer to sign in again; cancelling sign-in was the person's choice
        Error::NotSignedIn | Error::Cancelled => log::info!("{what}: {e}"),
        _ => log::warn!("{what}: {} — {e}", e.kind()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_emails() {
        assert_eq!(mask("arseni@gmail.com"), "a***@gmail.com");
        assert_eq!(mask("x@y.z"), "x***@y.z");
        assert_eq!(mask(""), "");
        assert_eq!(mask("not-an-email"), "***");
    }

    #[test]
    fn hides_ids_in_paths() {
        assert_eq!(
            path_shape("/calendar/v3/calendars/me%40gmail.com/events/abc123/instances"),
            "calendar/v3/calendars/…/events/…/instances"
        );
        assert_eq!(path_shape("/calendar/v3/calendars/primary/events"), "calendar/v3/calendars/…/events");
        assert_eq!(path_shape("/calendar/v3/users/me/calendarList"), "calendar/v3/users/me/calendarList");
    }
}
