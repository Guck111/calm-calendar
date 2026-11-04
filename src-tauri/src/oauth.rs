//! Вход через Google для настольного приложения:
//! системный браузер + приём кода на 127.0.0.1 + PKCE (RFC 7636).
//! Токен обновления хранится в системном хранилище паролей
//! (на Windows это диспетчер учётных данных), а не в файле.

use crate::config::{self, Account, ClientConfig};
use crate::error::{Error, Result};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::{Rng, distributions::Alphanumeric};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;
use url::Url;

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";

const CALENDAR_SCOPES: [&str; 2] = [
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    "https://www.googleapis.com/auth/calendar.events",
];
const ID_SCOPES: [&str; 2] = ["openid", "email"];

const KEYRING_SERVICE: &str = "com.arseni.calmcalendar";
const KEYRING_USER: &str = "google-refresh-token";
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);
/// браузер присылает запрос сразу; соединение, которое молчит дольше, — не браузер
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

struct AccessToken {
    value: String,
    expires_at: Instant,
}

pub struct Auth {
    http: reqwest::Client,
    token: Mutex<Option<AccessToken>>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
    refresh_token: Option<String>,
    id_token: Option<String>,
    scope: Option<String>,
}

#[derive(Deserialize)]
struct TokenError {
    error: String,
    error_description: Option<String>,
}

fn random_string(len: usize) -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(len)
        .map(char::from)
        .collect()
}

fn keyring_entry() -> Result<keyring::Entry> {
    Ok(keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)?)
}

fn stored_refresh_token() -> Option<String> {
    keyring_entry().ok()?.get_password().ok()
}

fn delete_refresh_token() {
    if let Ok(entry) = keyring_entry() {
        let _ = entry.delete_credential();
    }
}

/// Достаёт email из id_token. Подпись не проверяем: токен получен
/// напрямую от Google по HTTPS и используется только для отображения.
fn email_from_id_token(id_token: &str) -> Option<String> {
    let payload = id_token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    let json: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    json.get("email")?.as_str().map(str::to_owned)
}

const PAGE_OK: &str = "<!doctype html><meta charset=utf-8><title>Calm Calendar</title>\
<body style=\"font:16px system-ui;display:grid;place-items:center;height:90vh;margin:0\">\
<p>Готово. Эту вкладку можно закрыть и вернуться в приложение.</p>";
const PAGE_FAIL: &str = "<!doctype html><meta charset=utf-8><title>Calm Calendar</title>\
<body style=\"font:16px system-ui;display:grid;place-items:center;height:90vh;margin:0\">\
<p>Вход не выполнен. Вернись в приложение и попробуй ещё раз.</p>";

async fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    let resp = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(resp.as_bytes()).await;
    let _ = stream.shutdown().await;
}

async fn read_request_line(stream: &mut TcpStream) -> Option<String> {
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    while !buf.windows(4).any(|w| w == b"\r\n\r\n") && buf.len() < 16 * 1024 {
        let n = stream.read(&mut chunk).await.ok()?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    let text = String::from_utf8_lossy(&buf);
    text.lines().next().map(str::to_owned)
}

/// Разбирает один запрос браузера. None — запрос не тот (чужой, favicon, неверный state).
async fn handle_redirect(mut stream: TcpStream, expected_state: String) -> Option<Result<String>> {
    // молчащее соединение от другой программы закрываем, а не ждём
    let Ok(Some(line)) = tokio::time::timeout(REQUEST_TIMEOUT, read_request_line(&mut stream)).await else {
        return None;
    };
    // "GET /?code=...&state=... HTTP/1.1"
    let target = line.split_whitespace().nth(1).unwrap_or("");
    let Ok(url) = Url::parse(&format!("http://127.0.0.1{target}")) else {
        respond(&mut stream, "400 Bad Request", PAGE_FAIL).await;
        return None;
    };
    if url.path() != "/" {
        // например, запрос favicon.ico
        respond(&mut stream, "404 Not Found", "").await;
        return None;
    }
    let param = |name: &str| {
        url.query_pairs()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.into_owned())
    };
    if param("state").as_deref() != Some(expected_state.as_str()) {
        respond(&mut stream, "400 Bad Request", PAGE_FAIL).await;
        return None;
    }
    if let Some(err) = param("error") {
        respond(&mut stream, "200 OK", PAGE_FAIL).await;
        return Some(Err(Error::Denied(err)));
    }
    if let Some(code) = param("code") {
        respond(&mut stream, "200 OK", PAGE_OK).await;
        return Some(Ok(code));
    }
    respond(&mut stream, "400 Bad Request", PAGE_FAIL).await;
    None
}

/// Ждёт, пока браузер вернётся на 127.0.0.1 с кодом авторизации.
/// Каждое соединение обрабатывается отдельно, поэтому медленное или чужое не задерживает браузер.
async fn wait_for_code(listener: &TcpListener, expected_state: &str) -> Result<String> {
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Result<String>>(1);
    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let (stream, _) = accepted?;
                let tx = tx.clone();
                let state = expected_state.to_owned();
                tokio::spawn(async move {
                    if let Some(result) = handle_redirect(stream, state).await {
                        let _ = tx.send(result).await;
                    }
                });
            }
            Some(result) = rx.recv() => return result,
        }
    }
}

impl Auth {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(30))
                .build()
                .expect("HTTP client"),
            token: Mutex::new(None),
        }
    }

    pub fn http(&self) -> &reqwest::Client {
        &self.http
    }

    pub fn is_signed_in(&self) -> bool {
        stored_refresh_token().is_some()
    }

    async fn post_token(&self, form: &[(&str, &str)]) -> Result<TokenResponse> {
        let resp = self.http.post(TOKEN_URL).form(form).send().await?;
        if resp.status().is_success() {
            return Ok(resp.json().await?);
        }
        let status = resp.status().as_u16();
        let err: TokenError = resp.json().await.unwrap_or(TokenError {
            error: "unknown".into(),
            error_description: None,
        });
        if err.error == "invalid_grant" {
            // токен отозван или истёк — нужен новый вход
            delete_refresh_token();
            return Err(Error::NotSignedIn);
        }
        Err(Error::Google {
            status,
            message: err.error_description.unwrap_or(err.error),
        })
    }

    pub async fn sign_in(&self, app: &AppHandle) -> Result<Option<String>> {
        let client = config::client(app)?;
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let redirect_uri = format!("http://127.0.0.1:{}", listener.local_addr()?.port());

        let verifier = random_string(64);
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let state = random_string(32);
        let scope = CALENDAR_SCOPES
            .iter()
            .chain(ID_SCOPES.iter())
            .copied()
            .collect::<Vec<_>>()
            .join(" ");

        let mut auth_url = Url::parse(AUTH_URL)?;
        auth_url
            .query_pairs_mut()
            .append_pair("client_id", &client.client_id)
            .append_pair("redirect_uri", &redirect_uri)
            .append_pair("response_type", "code")
            .append_pair("scope", &scope)
            .append_pair("code_challenge", &challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", &state)
            .append_pair("access_type", "offline")
            .append_pair("prompt", "consent");

        app.opener()
            .open_url(auth_url.as_str(), None::<&str>)
            .map_err(|e| Error::Other(format!("Не удалось открыть браузер: {e}")))?;

        let code = tokio::time::timeout(SIGN_IN_TIMEOUT, wait_for_code(&listener, &state))
            .await
            .map_err(|_| Error::Timeout)??;

        let tokens = self
            .exchange_code(&client, &code, &verifier, &redirect_uri)
            .await?;

        let granted = tokens.scope.clone().unwrap_or_default();
        if !CALENDAR_SCOPES.iter().all(|s| granted.split(' ').any(|g| g == *s)) {
            return Err(Error::MissingScope);
        }
        let refresh = tokens
            .refresh_token
            .clone()
            .ok_or_else(|| Error::Other("Google не выдал токен обновления".into()))?;
        keyring_entry()?.set_password(&refresh)?;

        let email = tokens.id_token.as_deref().and_then(email_from_id_token);
        config::save_account(app, &Account { email: email.clone() })?;

        *self.token.lock().await = Some(AccessToken {
            value: tokens.access_token,
            expires_at: Instant::now() + Duration::from_secs(tokens.expires_in),
        });
        Ok(email)
    }

    async fn exchange_code(
        &self,
        client: &ClientConfig,
        code: &str,
        verifier: &str,
        redirect_uri: &str,
    ) -> Result<TokenResponse> {
        self.post_token(&[
            ("client_id", client.client_id.as_str()),
            ("client_secret", client.client_secret.as_str()),
            ("code", code),
            ("code_verifier", verifier),
            ("redirect_uri", redirect_uri),
            ("grant_type", "authorization_code"),
        ])
        .await
    }

    /// Действующий токен доступа; при необходимости обновляет его.
    pub async fn access_token(&self, app: &AppHandle) -> Result<String> {
        let mut guard = self.token.lock().await;
        if let Some(t) = guard.as_ref() {
            // запас в минуту, чтобы токен не истёк посреди запроса
            if t.expires_at > Instant::now() + Duration::from_secs(60) {
                return Ok(t.value.clone());
            }
        }
        let refresh = stored_refresh_token().ok_or(Error::NotSignedIn)?;
        let client = config::client(app)?;
        let tokens = self
            .post_token(&[
                ("client_id", client.client_id.as_str()),
                ("client_secret", client.client_secret.as_str()),
                ("refresh_token", refresh.as_str()),
                ("grant_type", "refresh_token"),
            ])
            .await?;
        let value = tokens.access_token.clone();
        *guard = Some(AccessToken {
            value: tokens.access_token,
            expires_at: Instant::now() + Duration::from_secs(tokens.expires_in),
        });
        Ok(value)
    }

    pub async fn forget_access_token(&self) {
        *self.token.lock().await = None;
    }

    pub async fn sign_out(&self, app: &AppHandle) {
        if let Some(refresh) = stored_refresh_token() {
            // отзываем доступ у Google; ошибку сети не считаем фатальной
            let _ = self
                .http
                .post(REVOKE_URL)
                .form(&[("token", refresh.as_str())])
                .send()
                .await;
        }
        delete_refresh_token();
        self.forget_access_token().await;
        config::clear_account(app);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_email_from_id_token() {
        let payload = URL_SAFE_NO_PAD.encode(br#"{"email":"a@b.com","sub":"1"}"#);
        assert_eq!(
            email_from_id_token(&format!("h.{payload}.s")).as_deref(),
            Some("a@b.com")
        );
        assert_eq!(email_from_id_token("broken"), None);
    }

    #[tokio::test]
    async fn silent_connection_does_not_block_browser() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let waiter = tokio::spawn(async move { wait_for_code(&listener, "st").await });

        // чужая программа подключилась и молчит
        let _silent = TcpStream::connect(addr).await.unwrap();
        // чужой запрос с неверным state игнорируется
        let mut wrong = TcpStream::connect(addr).await.unwrap();
        wrong.write_all(b"GET /?code=evil&state=bad HTTP/1.1\r\n\r\n").await.unwrap();
        // браузер приходит следом и не ждёт молчащее соединение
        let mut browser = TcpStream::connect(addr).await.unwrap();
        browser.write_all(b"GET /?code=good&state=st HTTP/1.1\r\n\r\n").await.unwrap();

        let code = tokio::time::timeout(Duration::from_secs(2), waiter).await.unwrap().unwrap().unwrap();
        assert_eq!(code, "good");
    }

    #[test]
    fn pkce_challenge_matches_rfc_example() {
        // пример из RFC 7636, приложение B
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        assert_eq!(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }
}
