//! Быстрое создание из любого места Windows: сочетание клавиш (по умолчанию Ctrl+Alt+Space)
//! открывает маленькое окно со строкой быстрого создания поверх всех окон, даже когда
//! календарь свёрнут в трей. Окно прячется после создания, по Esc и когда уходит фокус.

use crate::config;
use crate::desktop;
use crate::error::{Error, Result};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub const QUICK: &str = "quick";
/// размер окна в логических пикселях: строка и подсказка под ней с календарём и местом
const SIZE: (f64, f64) = (520.0, 200.0);

/// Плагин сочетаний: на нажатие (не на отпускание) — окно быстрого создания
pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                show(app);
            }
        })
        .build()
}

/// Регистрирует сочетание вместо прежнего; None — выключить.
/// Сочетание может быть занято другой программой — тогда ошибка, прежнее уже снято
pub fn register(app: &AppHandle, hotkey: Option<&str>) -> Result<()> {
    let shortcuts = app.global_shortcut();
    let _ = shortcuts.unregister_all();
    let Some(hotkey) = hotkey else { return Ok(()) };
    if !config::valid_hotkey(hotkey) {
        return Err(Error::Other(format!("unknown shortcut {hotkey}")));
    }
    shortcuts.register(hotkey).map_err(|e| Error::Other(format!("shortcut {hotkey}: {e}")))
}

/// При запуске: сочетание из настроек. Занято другой программой — первое свободное из списка,
/// и оно сохраняется в настройках, чтобы там было видно, какое работает. Все заняты — только запись в журнал
pub fn setup(app: &AppHandle) {
    let settings = config::load_settings(app);
    if let Some(chosen) = settings.quick_hotkey.clone() {
        let mut active = None;
        for hotkey in config::hotkey_candidates(&chosen) {
            match register(app, Some(hotkey)) {
                Ok(()) => {
                    active = Some(hotkey);
                    break;
                }
                Err(e) => log::warn!("quick add shortcut: {e}"),
            }
        }
        match active {
            Some(hotkey) if hotkey != chosen => {
                log::info!("quick add shortcut: {chosen} is taken, using {hotkey}");
                let _ = config::save_settings(app, config::Settings { quick_hotkey: Some(hotkey.to_owned()), ..settings });
            }
            Some(_) => {}
            None => log::warn!("quick add shortcut: every shortcut is taken"),
        }
    }
    // только в сборке для разработки: `CALM_DEMO_QUICK=1` открывает окно тем же кодом, что и сочетание
    #[cfg(debug_assertions)]
    if std::env::var_os("CALM_DEMO_QUICK").is_some() {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
            show(&app);
        });
    }
}

/// Верхняя треть экрана, где сейчас мышь, по центру: как у поиска Windows
fn position(app: &AppHandle) -> Option<tauri::PhysicalPosition<i32>> {
    let cursor = app.cursor_position().ok();
    let monitor = cursor
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())?;
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let width = (SIZE.0 * scale) as i32;
    Some(tauri::PhysicalPosition::new(
        area.position.x + (area.size.width as i32 - width) / 2,
        area.position.y + area.size.height as i32 / 4,
    ))
}

pub fn show(app: &AppHandle) {
    let w = match app.get_webview_window(QUICK) {
        Some(w) => w,
        None => {
            let built = tauri::WebviewWindowBuilder::new(app, QUICK, tauri::WebviewUrl::App("index.html?window=quick".into()))
                .title("Calm Calendar")
                .inner_size(SIZE.0, SIZE.1)
                .resizable(false)
                .decorations(false)
                .skip_taskbar(true)
                .always_on_top(true)
                .visible(false)
                .build();
            match built {
                Ok(w) => {
                    desktop::round_corners(&w);
                    w
                }
                Err(e) => {
                    log::error!("quick add window: {e}");
                    return;
                }
            }
        }
    };
    if let Some(pos) = position(app) {
        let _ = w.set_position(pos);
    }
    let _ = app.emit_to(QUICK, "quick-shown", ());
    let _ = w.show();
    let _ = w.set_focus();
}

pub fn hide(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(QUICK) {
        let _ = w.hide();
    }
}

/// Фокус ушёл: как у списка дел, ждём 200 мс — сразу после показа фокус на миг уходит к веб-странице
pub fn lost_focus(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        let focused = app.get_webview_window(QUICK).and_then(|w| w.is_focused().ok()).unwrap_or(false);
        if !focused {
            hide(&app);
        }
    });
}
