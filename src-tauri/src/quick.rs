//! Quick add from anywhere in Windows: a hotkey (Ctrl+Alt+Space by default)
//! opens a small window with the quick add input on top of all windows, even when
//! the calendar is minimized to the tray. The window hides after creating, on Esc and when focus leaves.

use crate::config;
use crate::desktop;
use crate::error::{Error, Result};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub const QUICK: &str = "quick";
/// window size in logical pixels: the input and the hint below it with calendar and location
const SIZE: (f64, f64) = (520.0, 200.0);

/// Hotkey plugin: on press (not on release) — the quick add window
pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                show(app);
            }
        })
        .build()
}

/// Registers the hotkey in place of the previous one; None — turn off.
/// The hotkey may be taken by another program — then an error, the previous one is already unregistered
pub fn register(app: &AppHandle, hotkey: Option<&str>) -> Result<()> {
    let shortcuts = app.global_shortcut();
    let _ = shortcuts.unregister_all();
    let Some(hotkey) = hotkey else { return Ok(()) };
    if !config::valid_hotkey(hotkey) {
        return Err(Error::Other(format!("unknown shortcut {hotkey}")));
    }
    shortcuts.register(hotkey).map_err(|e| Error::Other(format!("shortcut {hotkey}: {e}")))
}

/// At startup: the hotkey from settings. Taken by another program — the first free one from the list,
/// and it is saved in settings so they show which one works. All taken — only a log record
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
    // development build only: `CALM_DEMO_QUICK=1` opens the window with the same code as the hotkey
    #[cfg(debug_assertions)]
    if std::env::var_os("CALM_DEMO_QUICK").is_some() {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
            show(&app);
        });
    }
}

/// Upper third of the screen where the mouse is now, centered: like Windows search
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

/// Focus left: like the agenda, wait 200 ms — right after showing, focus briefly goes to the web page
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
