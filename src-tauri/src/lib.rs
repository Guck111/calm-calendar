mod autostart;
mod config;
mod desktop;
mod error;
mod google;
mod i18n;
mod oauth;
mod reminders;
#[cfg(windows)]
mod toast;

use config::ClientSource;
use error::Result;
use oauth::Auth;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, State, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_window_state::StateFlags;

#[derive(Serialize)]
struct AuthStatus {
    client_source: ClientSource,
    signed_in: bool,
    email: Option<String>,
}

#[tauri::command]
fn auth_status(app: AppHandle, auth: State<'_, Auth>) -> AuthStatus {
    AuthStatus {
        client_source: config::client_source(&app),
        signed_in: auth.is_signed_in(),
        email: config::load_account(&app).email,
    }
}

#[tauri::command]
fn save_client_config(app: AppHandle, client_id: String, client_secret: String) -> Result<()> {
    config::save_client(&app, &client_id, &client_secret)
}

#[tauri::command]
async fn sign_in(app: AppHandle, auth: State<'_, Auth>) -> Result<Option<String>> {
    auth.sign_in(&app).await
}

#[tauri::command]
async fn sign_out(app: AppHandle, auth: State<'_, Auth>) -> Result<()> {
    auth.sign_out(&app).await;
    Ok(())
}

#[tauri::command]
async fn google_request(
    app: AppHandle,
    auth: State<'_, Auth>,
    method: String,
    path: String,
    query: Option<Vec<(String, String)>>,
    body: Option<Value>,
) -> Result<Value> {
    google::request(&app, &auth, &method, &path, query.unwrap_or_default(), body).await
}

/// Открыть главное окно из виджета или списка у трея, при необходимости сразу на нужном дне ("2026-11-04")
#[tauri::command]
fn open_main(app: AppHandle, date: Option<String>) {
    desktop::show_main(&app, date);
}

/// Спрятать список дел у значка в трее (кнопка в нём или Esc)
#[tauri::command]
fn hide_agenda(app: AppHandle) {
    desktop::hide_agenda(&app);
}

#[tauri::command]
fn get_settings(app: AppHandle) -> config::Settings {
    config::load_settings(&app)
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

/// Заметное напоминание: выключено, только видеовстречи или все события со временем
#[tauri::command]
fn set_alerts(app: AppHandle, mode: config::AlertMode) -> Result<()> {
    let settings = config::Settings { alerts: mode, ..config::load_settings(&app) };
    config::save_settings(&app, settings)
}

/// Напоминания, которые сейчас в окне поверх всех окон
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

/// Отложить напоминание; окно покажется снова через minutes минут (от 1 до 60)
#[tauri::command]
async fn snooze_alert(
    app: AppHandle,
    reminders: State<'_, reminders::Reminders>,
    key: String,
    minutes: i64,
) -> Result<()> {
    let empty = reminders.snooze(&key, minutes.clamp(1, 60)).await;
    desktop::alerts_changed(&app, empty);
    Ok(())
}

/// Язык интерфейса ("ru" или "en"): меню трея и страница входа в браузере
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

/// Новое расписание напоминаний целиком. При выключенных уведомлениях остаются только
/// заметные напоминания: у них своя настройка, её проверяют в момент показа
#[tauri::command]
async fn schedule_reminders(
    app: AppHandle,
    reminders: State<'_, reminders::Reminders>,
    items: Vec<reminders::Reminder>,
) -> Result<()> {
    let enabled = config::load_settings(&app).notifications;
    reminders.replace(items.into_iter().filter(|r| enabled || r.alert).collect()).await;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // повторный запуск (например, ярлыком) не создаёт вторую копию, а показывает окно
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            desktop::show_main(app, None);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                // видимость окон решаем сами: главное скрыто при автозапуске, виджет — по настройке
                .with_state_flags(StateFlags::POSITION | StateFlags::SIZE | StateFlags::MAXIMIZED)
                // окно напоминания всегда открывается по центру экрана
                .with_denylist(&[desktop::ALERT, desktop::AGENDA])
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![desktop::HIDDEN_ARG]),
        ))
        .manage(Auth::new())
        .manage(reminders::Reminders::default())
        .manage(desktop::TrayItems::default())
        .manage(desktop::AgendaHidden::default())
        .setup(|app| {
            desktop::setup(app.handle())?;
            reminders::start(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            // крестик главного окна прячет его в трей, выход — через меню трея
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == desktop::MAIN {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            // список дел у значка в трее прячется, как только уходит фокус
            if let WindowEvent::Focused(false) = event {
                if window.label() == desktop::AGENDA {
                    desktop::agenda_lost_focus(window.app_handle());
                }
            }
            // окно напоминания закрыли не кнопкой, а Alt+F4: забываем все открытые напоминания
            if let WindowEvent::Destroyed = event {
                if window.label() == desktop::ALERT {
                    let app = window.app_handle().clone();
                    tauri::async_runtime::spawn(async move {
                        app.state::<reminders::Reminders>().dismiss_all().await;
                    });
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            auth_status,
            save_client_config,
            sign_in,
            sign_out,
            google_request,
            open_main,
            get_settings,
            set_glass,
            set_notifications,
            set_private_notifications,
            set_language,
            schedule_reminders,
            set_alerts,
            get_alerts,
            dismiss_alert,
            snooze_alert,
            hide_agenda
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
