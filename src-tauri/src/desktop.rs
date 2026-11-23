//! Windows, tray icon and autostart.
//! The main window hides on close, the app keeps living in the tray and in the widget.

use crate::autostart;
use crate::config::{self, WidgetSettings};
use crate::i18n;
use std::sync::Mutex;
use serde::Serialize;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::window::{Color, Effect, EffectsBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow, Wry};

pub const MAIN: &str = "main";
pub const WIDGET: &str = "widget";
const DEV_IDENTIFIER_SUFFIX: &str = ".dev";
/// prominent reminder of an event start
pub const ALERT: &str = "alert";
/// agenda for today and tomorrow on a click on the tray icon
pub const AGENDA: &str = "agenda";
/// agenda size in logical pixels and the margin from the work area corner
const AGENDA_SIZE: (f64, f64) = (340.0, 440.0);
const AGENDA_MARGIN: f64 = 12.0;
const TRAY: &str = "main";
/// with this flag the app starts at Windows sign-in: without the main window
pub const HIDDEN_ARG: &str = "--hidden";

#[derive(Clone, Serialize)]
struct OpenDate {
    date: String,
}

fn window<R: Runtime>(app: &AppHandle<R>, label: &str) -> Option<WebviewWindow<R>> {
    app.get_webview_window(label)
}

/// Shows the main window; if a date is passed, opens that day
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

/// Widget and autostart — for the "What else it can do" card and the settings window
#[derive(Serialize)]
pub struct DesktopState {
    pub widget: bool,
    pub on_top: bool,
    pub autostart: bool,
}

pub fn desktop_state(app: &AppHandle) -> DesktopState {
    let widget = config::load_widget(app);
    DesktopState {
        widget: widget.visible,
        on_top: widget.on_top,
        autostart: autostart::is_enabled(app),
    }
}

fn tray_items(app: &AppHandle) -> Option<CheckItems> {
    app.state::<TrayItems>().0.lock().ok().and_then(|i| i.clone())
}

/// Show or hide the widget, keep it on top or not: from the UI; the tray menu checkboxes follow
pub fn set_widget(app: &AppHandle, settings: WidgetSettings) {
    config::save_widget(app, settings);
    apply_widget(app, settings);
    if let Some(items) = tray_items(app) {
        let _ = items.widget.set_checked(settings.visible);
        let _ = items.on_top.set_checked(settings.on_top);
    }
}

/// Turns autostart on or off; returns what actually happened (it can be disabled
/// in Task Manager). The tray menu checkbox reflects the actual state
pub fn set_launch(app: &AppHandle, want: bool) -> bool {
    let actual = autostart::set_enabled(app, want);
    if let Some(items) = tray_items(app) {
        let _ = items.launch.set_checked(actual);
    }
    actual
}

/// Glass: blur of what is under the window, done by Windows.
/// Main window — system Acrylic (fades without focus, the UI substitutes an opaque background).
/// The widget is almost always unfocused, so it needs the "old" Acrylic via the accent policy:
/// it doesn't turn off for an inactive window. The Blur effect gives a black background on new Windows 11 builds.
pub fn apply_glass(app: &AppHandle, enabled: bool) {
    if let Some(w) = window(app, MAIN) {
        let _ = if enabled {
            w.set_effects(
                EffectsBuilder::new()
                    .effect(Effect::Acrylic)
                    .color(Color(0, 0, 0, 0))
                    .build(),
            )
        } else {
            w.set_effects(None)
        };
    }
    if let Some(w) = window(app, WIDGET) {
        set_accent_acrylic(&w, enabled);
        round_corners(&w);
    }
    let _ = app.emit("glass-changed", enabled);
}

/// Turns Acrylic on or off via the undocumented but long-stable
/// user32 function SetWindowCompositionAttribute (also used by window-vibrancy and Rainmeter skins)
#[cfg(windows)]
fn set_accent_acrylic<R: Runtime>(w: &WebviewWindow<R>, enabled: bool) {
    use std::ffi::c_void;
    use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};

    #[repr(C)]
    struct AccentPolicy {
        accent_state: u32,
        accent_flags: u32,
        gradient_color: u32,
        animation_id: u32,
    }
    #[repr(C)]
    struct CompositionData {
        attribute: u32,
        data: *mut c_void,
        size: usize,
    }
    type SetWindowCompositionAttribute = unsafe extern "system" fn(*mut c_void, *mut CompositionData) -> i32;

    const WCA_ACCENT_POLICY: u32 = 19;
    const ACCENT_DISABLED: u32 = 0;
    const ACCENT_ENABLE_ACRYLICBLURBEHIND: u32 = 4;
    // color in 0xAABBGGRR format; an almost transparent tint, the main color is set by CSS.
    // Fully zero opacity breaks the effect on some Windows builds
    const TINT: u32 = 0x10_00_00_00;

    let Ok(hwnd) = w.hwnd() else { return };
    let name: Vec<u16> = "user32.dll\0".encode_utf16().collect();
    unsafe {
        let user32 = LoadLibraryW(name.as_ptr());
        if user32.is_null() {
            return;
        }
        let Some(proc) = GetProcAddress(user32, c"SetWindowCompositionAttribute".as_ptr().cast()) else {
            return;
        };
        let set: SetWindowCompositionAttribute = std::mem::transmute(proc);
        let mut policy = AccentPolicy {
            accent_state: if enabled { ACCENT_ENABLE_ACRYLICBLURBEHIND } else { ACCENT_DISABLED },
            accent_flags: 0,
            gradient_color: TINT,
            animation_id: 0,
        };
        let mut data = CompositionData {
            attribute: WCA_ACCENT_POLICY,
            data: &mut policy as *mut _ as *mut c_void,
            size: std::mem::size_of::<AccentPolicy>(),
        };
        set(hwnd.0 as _, &mut data);
    }
}

#[cfg(not(windows))]
fn set_accent_acrylic<R: Runtime>(_w: &WebviewWindow<R>, _enabled: bool) {}

/// A frameless window in Windows 11 is square by default: ask DWM to round the corners and remove the border
#[cfg(windows)]
pub fn round_corners<R: Runtime>(w: &WebviewWindow<R>) {
    use windows_sys::Win32::Graphics::Dwm::{
        DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
        DwmSetWindowAttribute,
    };
    let Ok(hwnd) = w.hwnd() else { return };
    let corner = DWMWCP_ROUND;
    let border = DWMWA_COLOR_NONE;
    // on Windows 10 the attributes don't exist — the calls just return an error
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
pub fn round_corners<R: Runtime>(_w: &WebviewWindow<R>) {}

/// Shows the prominent reminder window on top of all windows or updates the already open one
pub fn show_alert(app: &AppHandle) {
    if let Some(w) = window(app, ALERT) {
        let _ = app.emit_to(ALERT, "alerts-changed", ());
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let built = tauri::WebviewWindowBuilder::new(app, ALERT, tauri::WebviewUrl::App("index.html?window=alert".into()))
        .title(app_title(app))
        // the window fits its height to the content by itself, like the widget
        .inner_size(460.0, 180.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .center()
        .focused(true)
        .build();
    match built {
        Ok(w) => {
            round_corners(&w);
            let _ = w.set_focus();
        }
        Err(e) => log::error!("alert window: {e}"),
    }
}

pub fn close_alert(app: &AppHandle) {
    if let Some(w) = window(app, ALERT) {
        let _ = w.close();
    }
}

/// The list of open reminders changed: the window redraws or closes if empty
pub fn alerts_changed(app: &AppHandle, empty: bool) {
    if empty {
        close_alert(app);
    } else {
        let _ = app.emit_to(ALERT, "alerts-changed", ());
    }
}

/// When the agenda hid because of focus loss. A click on the icon first takes focus from the agenda,
/// and without this mark the same click would open it again right away
#[derive(Default)]
pub struct AgendaHidden(Mutex<Option<std::time::Instant>>);

pub fn hide_agenda(app: &AppHandle) {
    if let Some(w) = window(app, AGENDA) {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
            if let Ok(mut at) = app.state::<AgendaHidden>().0.lock() {
                *at = Some(std::time::Instant::now());
            }
        }
    }
}

/// Focus left. Right after showing, the window briefly gives focus to its own web page,
/// so hide the agenda only if the window is still inactive after 200 ms
pub fn agenda_lost_focus(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        let focused = window(&app, AGENDA).and_then(|w| w.is_focused().ok()).unwrap_or(false);
        if !focused {
            hide_agenda(&app);
        }
    });
}

/// Bottom right corner of the work area of the monitor with the icon: like system flyouts
fn agenda_position(app: &AppHandle, x: f64, y: f64) -> Option<tauri::PhysicalPosition<i32>> {
    let monitor = app.monitor_from_point(x, y).ok().flatten().or_else(|| app.primary_monitor().ok().flatten())?;
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let (w, h) = AGENDA_SIZE;
    let right = area.position.x + area.size.width as i32;
    let bottom = area.position.y + area.size.height as i32;
    Some(tauri::PhysicalPosition::new(
        right - ((w + AGENDA_MARGIN) * scale) as i32,
        bottom - ((h + AGENDA_MARGIN) * scale) as i32,
    ))
}

/// Left click on the icon: show the agenda or hide it if it's open
fn toggle_agenda(app: &AppHandle, x: f64, y: f64) {
    let just_hidden = app
        .state::<AgendaHidden>()
        .0
        .lock()
        .ok()
        .and_then(|at| *at)
        .is_some_and(|at| at.elapsed() < std::time::Duration::from_millis(400));
    if just_hidden {
        return;
    }
    let w = match window(app, AGENDA) {
        Some(w) => w,
        None => {
            let built = tauri::WebviewWindowBuilder::new(app, AGENDA, tauri::WebviewUrl::App("index.html?window=agenda".into()))
                .title(app_title(app))
                .inner_size(AGENDA_SIZE.0, AGENDA_SIZE.1)
                .resizable(false)
                .decorations(false)
                .skip_taskbar(true)
                .always_on_top(true)
                .visible(false)
                .build();
            match built {
                Ok(w) => {
                    round_corners(&w);
                    w
                }
                Err(e) => {
                    log::error!("agenda window: {e}");
                    return;
                }
            }
        }
    };
    if w.is_visible().unwrap_or(false) {
        let _ = w.hide();
        return;
    }
    if let Some(pos) = agenda_position(app, x, y) {
        let _ = w.set_position(pos);
    }
    let _ = app.emit_to(AGENDA, "agenda-shown", ());
    let _ = w.show();
    let _ = w.set_focus();
}

pub fn app_title(app: &AppHandle) -> String {
    title_for(&app.config().identifier)
}

fn title_for(identifier: &str) -> String {
    if identifier.ends_with(DEV_IDENTIFIER_SUFFIX) { "Calm Calendar Dev" } else { "Calm Calendar" }.to_owned()
}

fn mark_config_windows(app: &AppHandle) {
    let title = app_title(app);
    if let Some(w) = window(app, MAIN) {
        let _ = w.set_title(&title);
    }
    if let Some(w) = window(app, WIDGET) {
        let _ = w.set_title(&format!("{title} widget"));
    }
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    mark_config_windows(app);
    let hidden = std::env::args().any(|a| a == HIDDEN_ARG) || autostart::launched_at_startup();
    if !hidden {
        show_main(app, None);
    }
    let widget = config::load_widget(app);
    apply_widget(app, widget);
    // development build only: `CALM_DEMO_AGENDA=1 npx tauri dev` opens the agenda right away,
    // with the same code as a click on the tray icon
    #[cfg(debug_assertions)]
    if std::env::var_os("CALM_DEMO_AGENDA").is_some() {
        // after the main window, otherwise it takes focus and the agenda hides right away
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
            toggle_agenda(&app, 0.0, 0.0);
        });
    }
    apply_glass(app, config::load_settings(app).glass);
    build_tray(app)
}

/// Tray menu items with checkboxes. The handler reads them from here because on a language change
/// the menu is recreated entirely.
#[derive(Default)]
pub struct TrayItems(Mutex<Option<CheckItems>>);

#[derive(Clone)]
struct CheckItems {
    widget: CheckMenuItem<Wry>,
    on_top: CheckMenuItem<Wry>,
    launch: CheckMenuItem<Wry>,
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let text = i18n::tray(i18n::current(app));
    let widget = config::load_widget(app);
    let open = MenuItem::with_id(app, "open", text.open, true, None::<&str>)?;
    let show_widget = CheckMenuItem::with_id(app, "widget", text.widget, true, widget.visible, None::<&str>)?;
    let on_top = CheckMenuItem::with_id(app, "on_top", text.on_top, true, widget.on_top, None::<&str>)?;
    let launch =
        CheckMenuItem::with_id(app, "autostart", text.autostart, true, autostart::is_enabled(app), None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", text.quit, true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let separator2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &separator, &show_widget, &on_top, &launch, &separator2, &quit])?;
    if let Ok(mut items) = app.state::<TrayItems>().0.lock() {
        *items = Some(CheckItems { widget: show_widget, on_top, launch });
    }
    Ok(menu)
}

/// Tray menu anew: after a language change
pub fn rebuild_tray_menu(app: &AppHandle) {
    if let (Some(tray), Ok(menu)) = (app.tray_by_id(TRAY), build_menu(app)) {
        let _ = tray.set_menu(Some(menu));
    }
}

fn on_menu(app: &AppHandle, id: &str) {
    let items = app.state::<TrayItems>().0.lock().ok().and_then(|i| i.clone());
    match (id, items) {
        ("open", _) => show_main(app, None),
        ("quit", _) => app.exit(0),
        ("widget" | "on_top", Some(items)) => {
            let settings = WidgetSettings {
                visible: items.widget.is_checked().unwrap_or(true),
                on_top: items.on_top.is_checked().unwrap_or(false),
            };
            config::save_widget(app, settings);
            apply_widget(app, settings);
        }
        ("autostart", Some(items)) => {
            // failed (e.g. autostart is disabled in Task Manager) — the checkbox reflects the actual state
            set_launch(app, items.launch.is_checked().unwrap_or(false));
        }
        _ => {}
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app)?;
    let mut tray = TrayIconBuilder::with_id(TRAY)
        .tooltip(app_title(app))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| on_menu(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            // left click — agenda for today and tomorrow, right click — menu
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                position,
                ..
            } = event
            {
                toggle_agenda(tray.app_handle(), position.x, position.y);
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identifier(config: &str) -> String {
        let config: serde_json::Value = serde_json::from_str(config).unwrap();
        config["identifier"].as_str().unwrap().to_owned()
    }

    #[test]
    fn dev_build_windows_say_dev() {
        assert_eq!(title_for(&identifier(include_str!("../tauri.dev.conf.json"))), "Calm Calendar Dev");
    }

    #[test]
    fn release_windows_keep_the_app_name() {
        assert_eq!(title_for(&identifier(include_str!("../tauri.conf.json"))), "Calm Calendar");
        assert_eq!(title_for(&identifier(include_str!("../tauri.e2e.conf.json"))), "Calm Calendar");
    }
}
