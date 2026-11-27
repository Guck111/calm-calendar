//! Settings window: a separate frameless window, it can be dragged by its header anywhere,
//! including outside the calendar. Opens centered on the main window,
//! closes completely — the next open is centered again and with fresh settings.

use crate::desktop;
use crate::windowing;
use tauri::{AppHandle, Manager, PhysicalPosition, WebviewWindow};

pub const SETTINGS: &str = "settings";
/// size in logical pixels: the list of sections and one open section;
/// on a short screen the window is shorter, the section scrolls
const SIZE: (f64, f64) = (720.0, 560.0);

pub fn show(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(SETTINGS) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let main = app.get_webview_window(desktop::MAIN);
    let builder = tauri::WebviewWindowBuilder::new(app, SETTINGS, tauri::WebviewUrl::App("index.html?window=settings".into()))
        .title(crate::desktop::app_title(app))
        .inner_size(SIZE.0, height(main.as_ref()))
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .skip_taskbar(true)
        .visible(false);
    // the window belongs to the main one: stays above it and doesn't clutter the taskbar
    let builder = match &main {
        Some(m) => match builder.parent(m) {
            Ok(b) => b,
            Err(e) => {
                log::error!("settings window: {e}");
                return;
            }
        },
        None => builder,
    };
    match builder.build() {
        Ok(w) => {
            desktop::round_corners(&w);
            if let Some(pos) = main.as_ref().and_then(|m| centered(m, &w)) {
                let _ = w.set_position(pos);
            } else {
                let _ = w.center();
            }
            let _ = w.show();
            let _ = w.set_focus();
        }
        Err(e) => log::error!("settings window: {e}"),
    }
}

pub fn close(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(SETTINGS) {
        let _ = w.close();
    }
}

/// window height: no taller than the work area of the main window's monitor, with a margin
fn height(main: Option<&WebviewWindow>) -> f64 {
    let work_height = main
        .and_then(|m| m.current_monitor().ok().flatten())
        .map(|m| m.work_area().size.height as f64 / m.scale_factor());
    windowing::settings_height(SIZE.1, work_height)
}

/// centered on the main window, but entirely on its monitor
fn centered(main: &WebviewWindow, w: &WebviewWindow) -> Option<PhysicalPosition<i32>> {
    let monitor = main.current_monitor().ok().flatten();
    Some(windowing::centered(
        main.outer_position().ok()?,
        main.outer_size().ok()?,
        w.outer_size().ok()?,
        monitor.as_ref().map(|m| m.work_area()),
    ))
}
