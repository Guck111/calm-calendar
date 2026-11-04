mod config;
mod desktop;
mod error;
mod google;
mod oauth;

use config::ClientSource;
use error::Result;
use oauth::Auth;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, State, WindowEvent};
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

/// Открыть главное окно из виджета, при необходимости сразу на нужном дне ("2026-11-04")
#[tauri::command]
fn open_main(app: AppHandle, date: Option<String>) {
    desktop::show_main(&app, date);
}

#[tauri::command]
fn get_settings(app: AppHandle) -> config::Settings {
    config::load_settings(&app)
}

#[tauri::command]
fn set_glass(app: AppHandle, enabled: bool) -> Result<()> {
    config::save_settings(&app, config::Settings { glass: enabled })?;
    desktop::apply_glass(&app, enabled);
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
        .plugin(
            tauri_plugin_window_state::Builder::default()
                // видимость окон решаем сами: главное скрыто при автозапуске, виджет — по настройке
                .with_state_flags(StateFlags::POSITION | StateFlags::SIZE | StateFlags::MAXIMIZED)
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![desktop::HIDDEN_ARG]),
        ))
        .manage(Auth::new())
        .setup(|app| {
            desktop::setup(app.handle())?;
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
        })
        .invoke_handler(tauri::generate_handler![
            auth_status,
            save_client_config,
            sign_in,
            sign_out,
            google_request,
            open_main,
            get_settings,
            set_glass
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
