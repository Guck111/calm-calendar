// Журнал работы: файл в папке логов приложения (%LOCALAPPDATA%\<id>\logs), чтобы разбирать сбои
// у пользователей. В журнал не пишем токены, названия и описания событий; email — только в виде «a***@gmail.com».
use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};
use tauri_plugin_opener::OpenerExt;

use crate::error::{Error, Result};

/// имя файла журнала без расширения
const FILE_NAME: &str = "calm-calendar";
/// размер одного файла; старые файлы переименовываются с датой, хранится несколько последних
const MAX_FILE_SIZE: u128 = 1_000_000;
const KEEP_FILES: usize = 5;

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    // подробные записи — только из кода приложения и только в отладочной сборке; у библиотек — предупреждения
    // и ошибки: их отладочные строки бывают с личными данными (keyring пишет email в имени записи)
    let own = if cfg!(debug_assertions) { log::LevelFilter::Debug } else { log::LevelFilter::Info };
    tauri_plugin_log::Builder::new()
        .clear_targets()
        .targets([
            Target::new(TargetKind::LogDir { file_name: Some(FILE_NAME.into()) }),
            Target::new(TargetKind::Stdout),
        ])
        .level(log::LevelFilter::Warn)
        .level_for(env!("CARGO_CRATE_NAME"), own)
        // сообщения окон (log_message) идут с target "ui"
        .level_for("ui", log::LevelFilter::Info)
        .max_file_size(MAX_FILE_SIZE)
        .rotation_strategy(RotationStrategy::KeepSome(KEEP_FILES))
        .timezone_strategy(TimezoneStrategy::UseLocal)
        .build()
}

/// Паника в релизной сборке закрывает приложение (panic = "abort"); до этого успеваем записать её в журнал
pub fn install_panic_hook() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!("panic: {info}");
        default(info);
    }));
}

/// «a***@gmail.com»: по журналу видно, какой из аккаунтов, но не сам адрес
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

/// Путь запроса к Google без id календарей и событий: «calendars/…/events/…/instances»
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

/// Сообщение из интерфейса: окна сами пишут в журнал свои ошибки
pub fn from_ui(level: &str, window: &str, message: &str) {
    // строка из интерфейса может быть длинной (стек вызовов): ограничиваем
    let text: String = message.chars().take(4000).collect();
    match level {
        "error" => log::error!(target: "ui", "[{window}] {text}"),
        "warn" => log::warn!(target: "ui", "[{window}] {text}"),
        _ => log::info!(target: "ui", "[{window}] {text}"),
    }
}

/// Открыть папку с журналом в Проводнике
pub fn open_folder(app: &AppHandle) -> Result<()> {
    let dir = app.path().app_log_dir().map_err(|e| Error::Other(e.to_string()))?;
    std::fs::create_dir_all(&dir)?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| Error::Other(format!("Could not open the logs folder: {e}")))
}

/// Запись об ошибке команды: вид ошибки и текст без личных данных
pub fn command_failed(what: &str, e: &Error) {
    match e {
        // вход истёк — обычное дело, интерфейс сам предложит войти снова
        Error::NotSignedIn => log::info!("{what}: {e}"),
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
