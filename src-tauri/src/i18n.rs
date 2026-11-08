//! Строки, которые показывает Rust-часть: меню трея и страница в браузере после входа.
//! Язык выбирает интерфейс (команда set_language); до первого выбора — язык Windows.

use crate::config;
use tauri::AppHandle;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Lang {
    Ru,
    En,
}

impl Lang {
    pub fn parse(code: &str) -> Option<Self> {
        match code {
            "ru" => Some(Lang::Ru),
            "en" => Some(Lang::En),
            _ => None,
        }
    }

    pub fn code(self) -> &'static str {
        match self {
            Lang::Ru => "ru",
            Lang::En => "en",
        }
    }
}

/// Язык интерфейса Windows: русский — русский, всё остальное — английский
#[cfg(windows)]
fn system_lang() -> Lang {
    const LANG_RUSSIAN: u16 = 0x19;
    // младшие 10 бит LANGID — основной язык
    let id = unsafe { windows_sys::Win32::Globalization::GetUserDefaultUILanguage() };
    if id & 0x3ff == LANG_RUSSIAN { Lang::Ru } else { Lang::En }
}

#[cfg(not(windows))]
fn system_lang() -> Lang {
    let ru = std::env::var("LANG").is_ok_and(|v| v.starts_with("ru"));
    if ru { Lang::Ru } else { Lang::En }
}

pub fn current(app: &AppHandle) -> Lang {
    config::load_settings(app)
        .language
        .as_deref()
        .and_then(Lang::parse)
        .unwrap_or_else(system_lang)
}

pub struct TrayText {
    pub open: &'static str,
    pub widget: &'static str,
    pub on_top: &'static str,
    pub autostart: &'static str,
    pub quit: &'static str,
}

pub fn tray(lang: Lang) -> TrayText {
    match lang {
        Lang::Ru => TrayText {
            open: "Открыть календарь",
            widget: "Виджет на рабочем столе",
            on_top: "Виджет поверх окон",
            autostart: "Запускать при входе в Windows",
            quit: "Выход",
        },
        Lang::En => TrayText {
            open: "Open calendar",
            widget: "Desktop widget",
            on_top: "Widget always on top",
            autostart: "Launch at Windows sign-in",
            quit: "Quit",
        },
    }
}

/// Текст страницы, которую браузер показывает после входа
pub fn sign_in_page(lang: Lang, ok: bool) -> &'static str {
    match (lang, ok) {
        (Lang::Ru, true) => "Готово. Эту вкладку можно закрыть и вернуться в приложение.",
        (Lang::Ru, false) => "Вход не выполнен. Вернись в приложение и попробуй ещё раз.",
        (Lang::En, true) => "Done. You can close this tab and go back to the app.",
        (Lang::En, false) => "Sign-in failed. Go back to the app and try again.",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_language_codes() {
        assert_eq!(Lang::parse("ru"), Some(Lang::Ru));
        assert_eq!(Lang::parse("en"), Some(Lang::En));
        assert_eq!(Lang::parse("de"), None);
        assert_eq!(Lang::En.code(), "en");
    }
}
