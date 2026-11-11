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

/// account — из какого аккаунта выйти; без него — из всех
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

/// Ошибки и важные события окон пишутся в общий журнал
#[tauri::command]
fn log_message(window: tauri::Window, level: String, message: String) {
    logging::from_ui(&level, window.label(), &message);
}

/// Папка с журналом — для письма в поддержку
#[tauri::command]
fn open_logs(app: AppHandle) -> Result<()> {
    logging::open_folder(&app)
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

/// Скачать календарь .ics по ссылке подписки (из настроек); разбирает его интерфейс
#[tauri::command]
async fn fetch_feed(url: String) -> error::Result<String> {
    feeds::fetch(&url).await
}

/// Открыть окно настроек (шестерёнка в главном окне) или поднять уже открытое.
/// Асинхронная: окно, созданное в синхронной команде, в Windows намертво вешает приложение
#[tauri::command]
async fn open_settings(app: AppHandle) {
    settings::show(&app);
}

/// Закрыть окно настроек (крестик или Esc в нём)
#[tauri::command]
fn close_settings(app: AppHandle) {
    settings::close(&app);
}

/// Спрятать окно быстрого создания (после создания или по Esc)
#[tauri::command]
fn hide_quick(app: AppHandle) {
    quick::hide(&app);
}

/// Сочетание для быстрого создания из любого места; None — выключить.
/// Занято другой программой — ошибка, настройка не меняется, прежнее сочетание возвращается
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
    logging::install_panic_hook();
    tauri::Builder::default()
        // журнал подключаем первым, чтобы в него попали и ошибки других плагинов
        .plugin(logging::plugin())
        // повторный запуск (например, ярлыком) не создаёт вторую копию, а показывает окно
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            desktop::show_main(app, None);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(quick::plugin())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                // видимость окон решаем сами: главное скрыто при автозапуске, виджет — по настройке
                .with_state_flags(StateFlags::POSITION | StateFlags::SIZE | StateFlags::MAXIMIZED)
                // окно напоминания всегда открывается по центру экрана
                .with_denylist(&[desktop::ALERT, desktop::AGENDA, quick::QUICK, settings::SETTINGS])
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
            log::info!(
                "Calm Calendar {} started on {} {}",
                app.package_info().version,
                std::env::consts::OS,
                std::env::consts::ARCH
            );
            // вход старой версии (один аккаунт) переезжает в список аккаунтов
            oauth::migrate_legacy(app.handle());
            desktop::setup(app.handle())?;
            quick::setup(app.handle());
            reminders::start(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            // крестик главного окна прячет его в трей, выход — через меню трея
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == desktop::MAIN {
                    api.prevent_close();
                    let _ = window.hide();
                    // настройки принадлежат главному окну: без него им незачем висеть на экране
                    settings::close(window.app_handle());
                }
            }
            // список дел у значка в трее прячется, как только уходит фокус
            if let WindowEvent::Focused(false) = event {
                if window.label() == desktop::AGENDA {
                    desktop::agenda_lost_focus(window.app_handle());
                }
                if window.label() == quick::QUICK {
                    quick::lost_focus(window.app_handle());
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
            hide_agenda,
            hide_quick,
            open_settings,
            fetch_feed,
            close_settings,
            set_quick_hotkey,
            log_message,
            open_logs
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
