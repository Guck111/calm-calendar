//! Окна, значок в трее и автозапуск.
//! Главное окно при закрытии прячется, приложение продолжает жить в трее и в виджете.

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
/// заметное напоминание о начале события
pub const ALERT: &str = "alert";
/// список дел на сегодня и завтра по клику на значок в трее
pub const AGENDA: &str = "agenda";
/// размер списка в логических пикселях и отступ от угла рабочей области
const AGENDA_SIZE: (f64, f64) = (340.0, 440.0);
const AGENDA_MARGIN: f64 = 12.0;
const TRAY: &str = "main";
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
/// Главное окно — системный Acrylic (гаснет без фокуса, интерфейс подставляет непрозрачный фон).
/// Виджет почти всегда без фокуса, поэтому ему нужен «старый» Acrylic через accent policy:
/// он не выключается у неактивного окна. Эффект Blur в новых сборках Windows 11 даёт чёрный фон.
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

/// Включает или выключает Acrylic через недокументированную, но давно стабильную
/// функцию user32 SetWindowCompositionAttribute (её же используют window-vibrancy и Rainmeter-скины)
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
    // цвет в формате 0xAABBGGRR; почти прозрачный тон, основной цвет задаёт CSS.
    // Совсем нулевая прозрачность на части сборок Windows ломает эффект
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

/// Показывает окно заметного напоминания поверх всех окон или обновляет уже открытое
pub fn show_alert(app: &AppHandle) {
    if let Some(w) = window(app, ALERT) {
        let _ = app.emit_to(ALERT, "alerts-changed", ());
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let built = tauri::WebviewWindowBuilder::new(app, ALERT, tauri::WebviewUrl::App("index.html?window=alert".into()))
        .title("Calm Calendar")
        // высоту окно подгоняет под содержимое само, как виджет
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

/// Список открытых напоминаний изменился: окно перерисовывается или закрывается, если пусто
pub fn alerts_changed(app: &AppHandle, empty: bool) {
    if empty {
        close_alert(app);
    } else {
        let _ = app.emit_to(ALERT, "alerts-changed", ());
    }
}

/// Когда список спрятался из-за потери фокуса. Клик по значку сначала забирает фокус у списка,
/// и без этой отметки тот же клик сразу открыл бы его снова
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

/// Фокус ушёл. Сразу после показа окно на миг отдаёт фокус своей же веб-странице,
/// поэтому прячем список, только если через 200 мс окно всё ещё не активно
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

/// Правый нижний угол рабочей области того монитора, где значок: как у системных всплывающих окон
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

/// Левый клик по значку: показать список дел или спрятать, если он открыт
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
                .title("Calm Calendar")
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

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let hidden = std::env::args().any(|a| a == HIDDEN_ARG) || autostart::launched_at_startup();
    if !hidden {
        show_main(app, None);
    }
    let widget = config::load_widget(app);
    apply_widget(app, widget);
    // только в сборке для разработки: `CALM_DEMO_AGENDA=1 npx tauri dev` сразу открывает список дел,
    // тем же кодом, что и клик по значку в трее
    #[cfg(debug_assertions)]
    if std::env::var_os("CALM_DEMO_AGENDA").is_some() {
        // после главного окна, иначе оно заберёт фокус и список сразу спрячется
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
            toggle_agenda(&app, 0.0, 0.0);
        });
    }
    apply_glass(app, config::load_settings(app).glass);
    build_tray(app)
}

/// Пункты меню трея с галочками. Обработчик читает их отсюда, потому что при смене языка
/// меню пересоздаётся целиком.
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

/// Меню трея заново: после смены языка
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
            let want = items.launch.is_checked().unwrap_or(false);
            // не получилось (например, автозапуск запрещён в диспетчере задач) — галочка по факту
            let actual = autostart::set_enabled(app, want);
            if actual != want {
                let _ = items.launch.set_checked(actual);
            }
        }
        _ => {}
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app)?;
    let mut tray = TrayIconBuilder::with_id(TRAY)
        .tooltip("Calm Calendar")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| on_menu(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            // левый клик — список дел на сегодня и завтра, правый — меню
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
