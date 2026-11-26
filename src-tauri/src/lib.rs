mod autostart;
mod config;
mod desktop;
mod error;
mod feeds;
mod google;
mod i18n;
mod logging;
mod oauth;
mod quick;
mod reminders;
mod settings;
mod store;
#[cfg(windows)]
mod toast;
mod windowing;

use config::ClientSource;
use error::Result;
use oauth::Auth;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, State, WindowEvent};
use tauri_plugin_window_state::StateFlags;

#[derive(Serialize)]
struct AuthStatus {
    client_source: ClientSource,
    accounts: Vec<oauth::AccountStatus>,
}

#[tauri::command]
fn auth_status(app: AppHandle, auth: State<'_, Auth>) -> AuthStatus {
    AuthStatus {
        client_source: config::client_source(&app),
        accounts: auth.accounts(&app),
    }
}

#[tauri::command]
fn save_client_config(app: AppHandle, client_id: String, client_secret: String) -> Result<()> {
    config::save_client(&app, &client_id, &client_secret)
}

#[tauri::command]
async fn sign_in(app: AppHandle, auth: State<'_, Auth>) -> Result<String> {
    let result = auth.sign_in(&app).await;
    match &result {
        Ok(email) => log::info!("signed in: {}", logging::mask(email)),
        Err(e) => logging::command_failed("sign-in", e),
    }
    result
}

#[tauri::command]
fn sign_in_reopen(app: AppHandle, auth: State<'_, Auth>) -> Result<()> {
    auth.reopen_sign_in(&app)
}

#[tauri::command]
fn sign_in_cancel(auth: State<'_, Auth>) {
    auth.cancel_sign_in();
}

/// account — which account to sign out of; without it — of all
#[tauri::command]
async fn sign_out(app: AppHandle, auth: State<'_, Auth>, account: Option<String>) -> Result<()> {
    auth.sign_out(&app, account.as_deref()).await;
    log::info!("signed out: {}", account.as_deref().map(logging::mask).unwrap_or_else(|| "all accounts".into()));
    Ok(())
}

#[tauri::command]
async fn google_request(
    app: AppHandle,
    auth: State<'_, Auth>,
    account: String,
    method: String,
    path: String,
    query: Option<Vec<(String, String)>>,
    body: Option<Value>,
) -> Result<Value> {
    let result = google::request(&app, &auth, &account, &method, &path, query.unwrap_or_default(), body).await;
    if let Err(e) = &result {
        let what = format!("Google {method} {} ({})", logging::path_shape(&path), logging::mask(&account));
        logging::command_failed(&what, e);
    }
    result
}

/// Errors and important window events are written to the shared log
#[tauri::command]
fn log_message(window: tauri::Window, level: String, message: String) {
    logging::from_ui(&level, window.label(), &message);
}

/// Log folder — for an email to support
#[tauri::command]
fn open_logs(app: AppHandle) -> Result<()> {
    logging::open_folder(&app)
}

/// Whether the app was installed from Microsoft Store: only that build asks for a rating
#[tauri::command]
async fn store_rating_available() -> bool {
    store::is_store_build()
}

/// The Store's "Rate and review" dialog over the main window
#[tauri::command]
fn request_store_rating(app: AppHandle) {
    store::request_rating(&app);
}

/// Open the main window from the widget or the tray agenda, on the needed day if necessary ("2026-11-04")
#[tauri::command]
fn open_main(app: AppHandle, date: Option<String>) {
    desktop::show_main(&app, date);
}

/// Hide the agenda at the tray icon (a button in it or Esc)
#[tauri::command]
fn hide_agenda(app: AppHandle) {
    desktop::hide_agenda(&app);
}

/// Download an .ics calendar by subscription link (from settings); the UI parses it
#[tauri::command]
async fn fetch_feed(url: String) -> error::Result<String> {
    feeds::fetch(&url).await
}

/// Open the settings window (gear in the main window) or raise the already open one.
/// Async: a window created in a sync command hangs the app for good on Windows
#[tauri::command]
async fn open_settings(app: AppHandle) {
    settings::show(&app);
}

/// Close the settings window (cross or Esc in it)
#[tauri::command]
fn close_settings(app: AppHandle) {
    settings::close(&app);
}

/// Hide the quick add window (after creating or on Esc)
#[tauri::command]
fn hide_quick(app: AppHandle) {
    quick::hide(&app);
}

/// Hotkey for quick add from anywhere; None — turn off.
/// Taken by another program — an error, the setting doesn't change, the previous hotkey is restored
#[tauri::command]
fn set_quick_hotkey(app: AppHandle, hotkey: Option<String>) -> Result<()> {
    let previous = config::load_settings(&app).quick_hotkey;
    if let Err(e) = quick::register(&app, hotkey.as_deref()) {
        let _ = quick::register(&app, previous.as_deref());
        log::warn!("quick add shortcut: {e}");
        return Err(e);
    }
    let settings = config::Settings { quick_hotkey: hotkey, ..config::load_settings(&app) };
    config::save_settings(&app, settings)
}

#[tauri::command]
fn get_settings(app: AppHandle) -> config::Settings {
    config::load_settings(&app)
}

#[tauri::command]
fn get_desktop(app: AppHandle) -> desktop::DesktopState {
    desktop::desktop_state(&app)
}

/// visible, on_top: what to change; whatever isn't passed stays as it was
#[tauri::command]
fn set_widget(app: AppHandle, visible: Option<bool>, on_top: Option<bool>) {
    desktop::set_widget(&app, config::load_widget(&app).changed(visible, on_top));
}

/// Returns whether autostart is on after the attempt
#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> bool {
    desktop::set_launch(&app, enabled)
}

#[tauri::command]
fn set_glass(app: AppHandle, enabled: bool) -> Result<()> {
    let settings = config::Settings { glass: enabled, ..config::load_settings(&app) };
    config::save_settings(&app, settings)?;
    desktop::apply_glass(&app, enabled);
    Ok(())
}

#[tauri::command]
async fn set_notifications(
    app: AppHandle,
    reminders: State<'_, reminders::Reminders>,
    enabled: bool,
) -> Result<()> {
    let settings = config::Settings { notifications: enabled, ..config::load_settings(&app) };
    config::save_settings(&app, settings)?;
    if !enabled {
        reminders.keep_alerts_only().await;
    }
    Ok(())
}

/// Prominent reminder: off, video meetings only or all timed events
#[tauri::command]
fn set_alerts(app: AppHandle, mode: config::AlertMode) -> Result<()> {
    let settings = config::Settings { alerts: mode, ..config::load_settings(&app) };
    config::save_settings(&app, settings)
}

/// Reminders currently in the window on top of all windows
#[tauri::command]
async fn get_alerts(reminders: State<'_, reminders::Reminders>) -> Result<Vec<reminders::Reminder>> {
    Ok(reminders.open_alerts().await)
}

#[tauri::command]
async fn dismiss_alert(app: AppHandle, reminders: State<'_, reminders::Reminders>, key: String) -> Result<()> {
    let empty = reminders.dismiss(&key).await;
    desktop::alerts_changed(&app, empty);
    Ok(())
}

/// Snooze a reminder; the window shows again in minutes minutes (1 to 60)
#[tauri::command]
async fn snooze_alert(
    app: AppHandle,
    reminders: State<'_, reminders::Reminders>,
    key: String,
    minutes: i64,
) -> Result<()> {
    let empty = reminders.snooze(&key, minutes).await;
    desktop::alerts_changed(&app, empty);
    Ok(())
}

/// UI language ("ru" or "en"): tray menu and the sign-in page in the browser
#[tauri::command]
fn set_language(app: AppHandle, language: String) -> Result<()> {
    let Some(lang) = i18n::Lang::parse(&language) else {
        return Ok(());
    };
    let settings = config::Settings { language: Some(lang.code().to_owned()), ..config::load_settings(&app) };
    config::save_settings(&app, settings)?;
    desktop::rebuild_tray_menu(&app);
    Ok(())
}

#[tauri::command]
fn set_private_notifications(app: AppHandle, enabled: bool) -> Result<()> {
    let settings = config::Settings { private_notifications: enabled, ..config::load_settings(&app) };
    config::save_settings(&app, settings)
}

/// The whole new reminder schedule. With notifications off only
/// prominent reminders remain: they have their own setting, checked at show time
#[tauri::command]
async fn schedule_reminders(
    app: AppHandle,
    reminders: State<'_, reminders::Reminders>,
    items: Vec<reminders::Reminder>,
) -> Result<()> {
    reminders.schedule(items, config::load_settings(&app).notifications).await;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logging::install_panic_hook();
    tauri::Builder::default()
        // the log plugin goes first so that errors of other plugins get into it too
        .plugin(logging::plugin())
        // a second launch (e.g. from a shortcut) doesn't create a second instance, but shows the window
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            desktop::show_main(app, None);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(quick::plugin())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                // we decide window visibility ourselves: the main one is hidden on autostart, the widget follows the setting
                .with_state_flags(StateFlags::POSITION | StateFlags::SIZE | StateFlags::MAXIMIZED)
                // the reminder window always opens in the center of the screen
                .with_denylist(&[desktop::ALERT, desktop::AGENDA, quick::QUICK, settings::SETTINGS])
                .build(),
        )
        .manage(reminders::Reminders::default())
        .manage(desktop::TrayItems::default())
        .manage(desktop::AgendaHidden::default())
        .setup(|app| {
            log::info!(
                "Calm Calendar {} started on {} {}",
                app.package_info().version,
                std::env::consts::OS,
                std::env::consts::ARCH
            );
            app.manage(Auth::new(app.config().identifier.clone()));
            autostart::setup(app.handle());
            // the old version's sign-in (single account) moves into the account list
            oauth::migrate_legacy(app.handle());
            desktop::setup(app.handle())?;
            quick::setup(app.handle());
            reminders::start(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            // the main window's cross hides it to the tray, quitting is via the tray menu
            if let WindowEvent::CloseRequested { api, .. } = event
                && window.label() == desktop::MAIN
            {
                api.prevent_close();
                let _ = window.hide();
                // settings belong to the main window: without it they have no reason to stay on screen
                settings::close(window.app_handle());
            }
            // the agenda at the tray icon hides as soon as focus leaves
            if let WindowEvent::Focused(false) = event {
                if window.label() == desktop::AGENDA {
                    desktop::agenda_lost_focus(window.app_handle());
                }
                if window.label() == quick::QUICK {
                    quick::lost_focus(window.app_handle());
                }
            }
            // the reminder window was closed with Alt+F4, not a button: forget all open reminders
            if let WindowEvent::Destroyed = event
                && window.label() == desktop::ALERT
            {
                let app = window.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    app.state::<reminders::Reminders>().dismiss_all().await;
                });
            }
        })
        .invoke_handler(tauri::generate_handler![
            auth_status,
            save_client_config,
            sign_in,
            sign_in_reopen,
            sign_in_cancel,
            sign_out,
            google_request,
            open_main,
            get_settings,
            get_desktop,
            set_widget,
            set_autostart,
            set_glass,
            set_notifications,
            set_private_notifications,
            set_language,
            schedule_reminders,
            set_alerts,
            get_alerts,
            dismiss_alert,
            snooze_alert,
            hide_agenda,
            hide_quick,
            open_settings,
            fetch_feed,
            close_settings,
            set_quick_hotkey,
            log_message,
            open_logs,
            store_rating_available,
            request_store_rating
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
