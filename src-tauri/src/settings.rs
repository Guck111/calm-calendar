//! Settings window: a separate frameless window, it can be dragged by its header anywhere,
//! including outside the calendar. Opens centered on the main window,
//! closes completely — the next open is centered again and with fresh settings.

use crate::desktop;
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
        .title("Calm Calendar")
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
    let area = main.and_then(|m| m.current_monitor().ok().flatten()).map(|m| {
        let scale = m.scale_factor();
        m.work_area().size.height as f64 / scale
    });
    match area {
        Some(h) => SIZE.1.min(h - 48.0).max(320.0),
        None => SIZE.1,
    }
}

/// centered on the main window, but entirely on its monitor
fn centered(main: &WebviewWindow, w: &WebviewWindow) -> Option<PhysicalPosition<i32>> {
    let pos = main.outer_position().ok()?;
    let size = main.outer_size().ok()?;
    let own = w.outer_size().ok()?;
    let mut x = pos.x + (size.width as i32 - own.width as i32) / 2;
    let mut y = pos.y + (size.height as i32 - own.height as i32) / 2;
    if let Some(m) = main.current_monitor().ok().flatten() {
        let area = m.work_area();
        let (ax, ay) = (area.position.x, area.position.y);
        let (aw, ah) = (area.size.width as i32, area.size.height as i32);
        x = x.clamp(ax, (ax + aw - own.width as i32).max(ax));
        y = y.clamp(ay, (ay + ah - own.height as i32).max(ay));
    }
    Some(PhysicalPosition::new(x, y))
}
