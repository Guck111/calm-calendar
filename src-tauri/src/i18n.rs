//! Строки, которые показывает Rust-часть: меню трея и страница в браузере после входа.
//! Язык выбирает интерфейс (команда set_language); до первого выбора — язык Windows.
//! Новый язык: вариант в Lang, строка в ALL и его тексты в texts().

use crate::config;
use tauri::AppHandle;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Lang {
    En,
    Ru,
    Es,
}

/// Порядок не важен: по нему только ищут код и язык Windows
const ALL: &[Lang] = &[Lang::En, Lang::Ru, Lang::Es];

pub struct TrayText {
    pub open: &'static str,
    pub widget: &'static str,
    pub on_top: &'static str,
    pub autostart: &'static str,
    pub quit: &'static str,
}

pub struct Texts {
    /// код в интерфейсе и в настройках
    code: &'static str,
    /// язык экрана согласия Google (параметр hl)
    hl: &'static str,
    /// основной язык в LANGID Windows (младшие 10 бит)
    langid: u16,
    rtl: bool,
    tray: TrayText,
    signed_in: &'static str,
    sign_in_failed: &'static str,
}

impl Lang {
    fn texts(self) -> Texts {
        match self {
            Lang::En => Texts {
                code: "en",
                hl: "en",
                langid: 0x09,
                rtl: false,
                tray: TrayText {
                    open: "Open calendar",
                    widget: "Desktop widget",
                    on_top: "Widget always on top",
                    autostart: "Launch at Windows sign-in",
                    quit: "Quit",
                },
                signed_in: "Done. You can close this tab and go back to the app.",
                sign_in_failed: "Sign-in failed. Go back to the app and try again.",
            },
            Lang::Ru => Texts {
                code: "ru",
                hl: "ru",
                langid: 0x19,
                rtl: false,
                tray: TrayText {
                    open: "Открыть календарь",
                    widget: "Виджет на рабочем столе",
                    on_top: "Виджет поверх окон",
                    autostart: "Запускать при входе в Windows",
                    quit: "Выход",
                },
                signed_in: "Готово. Эту вкладку можно закрыть и вернуться в приложение.",
                sign_in_failed: "Вход не выполнен. Вернись в приложение и попробуй ещё раз.",
            },
            Lang::Es => Texts {
                code: "es",
                hl: "es",
                langid: 0x0a,
                rtl: false,
                tray: TrayText {
                    open: "Abrir calendario",
                    widget: "Widget de escritorio",
                    on_top: "Widget siempre visible",
                    autostart: "Iniciar con Windows",
                    quit: "Salir",
                },
                signed_in: "Listo. Puedes cerrar esta pestaña y volver a la aplicación.",
                sign_in_failed: "No se pudo iniciar sesión. Vuelve a la aplicación e inténtalo de nuevo.",
            },
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        ALL.iter().copied().find(|l| l.code() == code)
    }

    pub fn code(self) -> &'static str {
        self.texts().code
    }

    /// Язык экрана входа Google
    pub fn hl(self) -> &'static str {
        self.texts().hl
    }

    /// Направление письма для страницы в браузере
    pub fn dir(self) -> &'static str {
        if self.texts().rtl { "rtl" } else { "ltr" }
    }

    fn from_langid(id: u16) -> Option<Self> {
        ALL.iter().copied().find(|l| l.texts().langid == id & 0x3ff)
    }
}

/// Язык интерфейса Windows, если на него есть перевод, иначе английский
#[cfg(windows)]
fn system_lang() -> Lang {
    let id = unsafe { windows_sys::Win32::Globalization::GetUserDefaultUILanguage() };
    Lang::from_langid(id).unwrap_or(Lang::En)
}

#[cfg(not(windows))]
fn system_lang() -> Lang {
    let env = std::env::var("LANG").unwrap_or_default();
    Lang::parse(env.get(..2).unwrap_or("")).unwrap_or(Lang::En)
}

pub fn current(app: &AppHandle) -> Lang {
    config::load_settings(app)
        .language
        .as_deref()
        .and_then(Lang::parse)
        .unwrap_or_else(system_lang)
}

pub fn tray(lang: Lang) -> TrayText {
    lang.texts().tray
}

/// Текст страницы, которую браузер показывает после входа
pub fn sign_in_page(lang: Lang, ok: bool) -> &'static str {
    let texts = lang.texts();
    if ok { texts.signed_in } else { texts.sign_in_failed }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_language_codes() {
        assert_eq!(Lang::parse("ru"), Some(Lang::Ru));
        assert_eq!(Lang::parse("en"), Some(Lang::En));
        assert_eq!(Lang::parse("xx"), None);
        assert_eq!(Lang::En.code(), "en");
    }

    #[test]
    fn every_language_round_trips() {
        for &l in ALL {
            assert_eq!(Lang::parse(l.code()), Some(l));
            assert_eq!(Lang::from_langid(l.texts().langid), Some(l));
        }
    }

    #[test]
    fn maps_windows_language_ids() {
        // 0x0419 — русский (Россия), 0x0809 — английский (Великобритания)
        assert_eq!(Lang::from_langid(0x0419), Some(Lang::Ru));
        assert_eq!(Lang::from_langid(0x0809), Some(Lang::En));
        assert_eq!(Lang::from_langid(0x0415), None);
    }
}
