mod config;
mod error;
mod google;
mod oauth;

use config::ClientSource;
use error::Result;
use oauth::Auth;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, State};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Auth::new())
        .invoke_handler(tauri::generate_handler![
            auth_status,
            save_client_config,
            sign_in,
            sign_out,
            google_request
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
