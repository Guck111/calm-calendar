//! Окна, значок в трее и автозапуск.
//! Главное окно при закрытии прячется, приложение продолжает жить в трее и в виджете.

use crate::config::{self, WidgetSettings};
use serde::Serialize;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::window::{Color, Effect, EffectsBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow, Wry};
use tauri_plugin_autostart::ManagerExt;

pub const MAIN: &str = "main";
pub const WIDGET: &str = "widget";
/// с этим флагом приложение запускается при входе в Windows: без главного окна
pub const HIDDEN_ARG: &str = "--hidden";

#[derive(Clone, Serialize)]
struct OpenDate {
    date: String,
}

fn window<R: Runtime>(app: &AppHandle<R>, label: &str) -> Option<WebviewWindow<R>> {
    app.get_webview_window(label)
}

/// Показывает главное окно; если передана дата, открывает этот день
pub fn show_main(app: &AppHandle, date: Option<String>) {
    if let Some(w) = window(app, MAIN) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    if let Some(date) = date {
        let _ = app.emit_to(MAIN, "open-date", OpenDate { date });
    }
}

pub fn apply_widget(app: &AppHandle, settings: WidgetSettings) {
    if let Some(w) = window(app, WIDGET) {
        let _ = w.set_always_on_top(settings.on_top);
        let _ = if settings.visible { w.show() } else { w.hide() };
    }
}

/// Стекло: размытие того, что под окном, средствами Windows.
/// Главное окно — Acrylic (гаснет без фокуса, интерфейс подставляет непрозрачный фон),
/// виджет — Blur: он почти всегда без фокуса, а Blur в этом случае не выключается.
pub fn apply_glass(app: &AppHandle, enabled: bool) {
    let clear = Color(0, 0, 0, 0);
    if let Some(w) = window(app, MAIN) {
        let _ = if enabled {
            w.set_effects(EffectsBuilder::new().effect(Effect::Acrylic).color(clear).build())
        } else {
            w.set_effects(None)
        };
    }
    if let Some(w) = window(app, WIDGET) {
        let _ = if enabled {
            w.set_effects(EffectsBuilder::new().effect(Effect::Blur).color(clear).build())
        } else {
            w.set_effects(None)
        };
        round_corners(&w);
    }
    let _ = app.emit("glass-changed", enabled);
}

/// Окно без рамки в Windows 11 по умолчанию квадратное: просим DWM скруглить углы и убрать рамку
#[cfg(windows)]
fn round_corners<R: Runtime>(w: &WebviewWindow<R>) {
    use windows_sys::Win32::Graphics::Dwm::{
        DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
        DwmSetWindowAttribute,
    };
    let Ok(hwnd) = w.hwnd() else { return };
    let corner = DWMWCP_ROUND;
    let border = DWMWA_COLOR_NONE;
    // на Windows 10 атрибутов нет — вызовы просто вернут ошибку
    unsafe {
        DwmSetWindowAttribute(
            hwnd.0 as _,
            DWMWA_WINDOW_CORNER_PREFERENCE as u32,
            &corner as *const _ as *const core::ffi::c_void,
            std::mem::size_of_val(&corner) as u32,
        );
        DwmSetWindowAttribute(
            hwnd.0 as _,
            DWMWA_BORDER_COLOR as u32,
            &border as *const _ as *const core::ffi::c_void,
            std::mem::size_of_val(&border) as u32,
        );
    }
}

#[cfg(not(windows))]
fn round_corners<R: Runtime>(_w: &WebviewWindow<R>) {}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let hidden = std::env::args().any(|a| a == HIDDEN_ARG);
    if !hidden {
        show_main(app, None);
    }
    let widget = config::load_widget(app);
    apply_widget(app, widget);
    apply_glass(app, config::load_settings(app).glass);
    build_tray(app, widget)
}

fn build_tray(app: &AppHandle, widget: WidgetSettings) -> tauri::Result<()> {
    let autostart = app.autolaunch().is_enabled().unwrap_or(false);

    let open = MenuItem::with_id(app, "open", "Открыть календарь", true, None::<&str>)?;
    let show_widget =
        CheckMenuItem::with_id(app, "widget", "Виджет на рабочем столе", true, widget.visible, None::<&str>)?;
    let on_top = CheckMenuItem::with_id(app, "on_top", "Виджет поверх окон", true, widget.on_top, None::<&str>)?;
    let launch = CheckMenuItem::with_id(app, "autostart", "Запускать при входе в Windows", true, autostart, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let separator2 = PredefinedMenuItem::separator(app)?;
    let menu: Menu<Wry> = Menu::with_items(
        app,
        &[&open, &separator, &show_widget, &on_top, &launch, &separator2, &quit],
    )?;

    let (show_widget_c, on_top_c, launch_c) = (show_widget.clone(), on_top.clone(), launch.clone());

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Calm Calendar")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "open" => show_main(app, None),
            "widget" | "on_top" => {
                let settings = WidgetSettings {
                    visible: show_widget_c.is_checked().unwrap_or(true),
                    on_top: on_top_c.is_checked().unwrap_or(false),
                };
                config::save_widget(app, settings);
                apply_widget(app, settings);
            }
            "autostart" => {
                let manager = app.autolaunch();
                let want = launch_c.is_checked().unwrap_or(false);
                let result = if want { manager.enable() } else { manager.disable() };
                if result.is_err() {
                    // не получилось — возвращаем галочку к реальному состоянию
                    let _ = launch_c.set_checked(manager.is_enabled().unwrap_or(false));
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle(), None);
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}
