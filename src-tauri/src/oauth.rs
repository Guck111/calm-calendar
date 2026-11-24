//! Google sign-in for a desktop app:
//! system browser + receiving the code on 127.0.0.1 + PKCE (RFC 7636).
//! There may be several accounts. Each one's refresh token is stored in the system
//! password store (on Windows it's Credential Manager), not in a file.

use crate::config::{self, Account, ClientConfig};
use crate::error::{Error, Result};
use crate::i18n::{self, Lang};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::{Rng, distributions::Alphanumeric};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use std::future::Future;
use std::sync::Arc;
use tokio::sync::{Mutex, Notify};
use url::Url;

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";

const CALENDAR_SCOPES: [&str; 2] = [
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    "https://www.googleapis.com/auth/calendar.events",
];
const ID_SCOPES: [&str; 2] = ["openid", "email"];

/// the single token of versions before 0.5; moved under a key with the email
const LEGACY_KEYRING_USER: &str = "google-refresh-token";
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);
/// the browser sends the request right away; a connection that stays silent longer is not the browser
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

/// a minute of margin so the token doesn't expire in the middle of a request
const TOKEN_MARGIN: Duration = Duration::from_secs(60);

struct AccessToken {
    value: String,
    expires_at: Instant,
}

impl AccessToken {
    fn issued(value: String, expires_in: u64, now: Instant) -> Self {
        Self { value, expires_at: now + Duration::from_secs(expires_in) }
    }

    fn is_fresh(&self, now: Instant) -> bool {
        self.expires_at > now + TOKEN_MARGIN
    }
}

pub struct Auth {
    http: reqwest::Client,
    /// password store service: the app identifier, so a dev build keeps its sign-ins apart from the installed app
    keyring_service: String,
    /// access tokens by account email
    tokens: Mutex<HashMap<String, AccessToken>>,
    /// sign-in currently waiting for the browser: its page can be opened again or cancelled
    pending: std::sync::Mutex<Option<PendingSignIn>>,
}

struct PendingSignIn {
    url: String,
    cancel: Arc<Notify>,
}

/// Removes the pending sign-in, however it ended
struct PendingGuard<'a>(&'a std::sync::Mutex<Option<PendingSignIn>>);

impl Drop for PendingGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut p) = self.0.lock() {
            *p = None;
        }
    }
}

/// Waits for the code from the browser until time runs out or the person presses "Cancel"
async fn wait_or_cancel<T>(wait: impl Future<Output = Result<T>>, cancel: &Notify, limit: Duration) -> Result<T> {
    tokio::select! {
        r = tokio::time::timeout(limit, wait) => r.map_err(|_| Error::Timeout)?,
        _ = cancel.notified() => Err(Error::Cancelled),
    }
}

/// Account for the UI: signed_in false — Google revoked access, need to sign in again
#[derive(Serialize)]
pub struct AccountStatus {
    pub email: String,
    pub signed_in: bool,
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

/// invalid_grant: the token was revoked or expired — a new sign-in to this account is needed; the account stays in the list
fn token_failure(status: u16, err: TokenError) -> Error {
    if err.error == "invalid_grant" {
        return Error::NotSignedIn;
    }
    Error::Google {
        status,
        message: err.error_description.unwrap_or(err.error),
    }
}

/// Google may grant only some of the requested scopes: the calendar needs all of them
fn has_calendar_scopes(granted: &str) -> bool {
    CALENDAR_SCOPES.iter().all(|s| granted.split(' ').any(|g| g == *s))
}

fn random_string(len: usize) -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(len)
        .map(char::from)
        .collect()
}

/// password store entry key: lowercase email
fn keyring_user(email: &str) -> String {
    format!("{LEGACY_KEYRING_USER}:{}", email.to_ascii_lowercase())
}

fn keyring_entry(service: &str, user: &str) -> Result<keyring::Entry> {
    Ok(keyring::Entry::new(service, user)?)
}

fn stored_refresh_token(service: &str, email: &str) -> Option<String> {
    keyring_entry(service, &keyring_user(email)).ok()?.get_password().ok()
}

fn delete_refresh_token(service: &str, email: &str) {
    let Ok(entry) = keyring_entry(service, &keyring_user(email)) else { return };
    // the old version's entry with the same token is removed too: otherwise sign-out would be incomplete
    if let (Ok(token), Ok(legacy)) = (entry.get_password(), keyring_entry(service, LEGACY_KEYRING_USER)) {
        if legacy.get_password().is_ok_and(|old| old == token) {
            let _ = legacy.delete_credential();
        }
    }
    let _ = entry.delete_credential();
}

/// Migrating the old version's sign-in: one token without email in the key and the email in account.json.
/// The token is copied, not moved: version 0.4 needs the old entry if it is still installed
/// (they share the password store). If the email is unknown, there's nothing to attach the token to — then sign in again.
pub fn migrate_legacy(app: &AppHandle) {
    if config::load_accounts(app).is_some() {
        return;
    }
    let service = &app.config().identifier;
    let token = keyring_entry(service, LEGACY_KEYRING_USER).ok().and_then(|e| e.get_password().ok());
    let mut accounts = Vec::new();
    if let (Some(email), Some(token)) = (config::legacy_email(app), token) {
        if keyring_entry(service, &keyring_user(&email)).and_then(|e| Ok(e.set_password(&token)?)).is_ok() {
            accounts.push(Account { email });
        }
    }
    let _ = config::save_accounts(app, &accounts);
}

/// Gets the email from id_token. The signature isn't checked: the token was received
/// directly from Google over HTTPS and is used only for display.
fn email_from_id_token(id_token: &str) -> Option<String> {
    let payload = id_token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    let json: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    json.get("email")?.as_str().map(str::to_owned)
}

fn page(lang: Lang, ok: bool) -> String {
    format!(
        "<!doctype html><html lang={} dir={}><meta charset=utf-8><title>Calm Calendar</title>\
<body style=\"font:16px system-ui;display:grid;place-items:center;height:90vh;margin:0\">\
<p>{}</p>",
        lang.code(),
        lang.dir(),
        i18n::sign_in_page(lang, ok)
    )
}

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

/// Parses one browser request. None — not the right request (foreign, favicon, wrong state).
async fn handle_redirect(mut stream: TcpStream, expected_state: String, lang: Lang) -> Option<Result<String>> {
    // a silent connection from another program is closed instead of waited on
    let Ok(Some(line)) = tokio::time::timeout(REQUEST_TIMEOUT, read_request_line(&mut stream)).await else {
        return None;
    };
    // "GET /?code=...&state=... HTTP/1.1"
    let target = line.split_whitespace().nth(1).unwrap_or("");
    let Ok(url) = Url::parse(&format!("http://127.0.0.1{target}")) else {
        respond(&mut stream, "400 Bad Request", &page(lang, false)).await;
        return None;
    };
    if url.path() != "/" {
        // e.g. a favicon.ico request
        respond(&mut stream, "404 Not Found", "").await;
        return None;
    }
    let param = |name: &str| {
        url.query_pairs()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.into_owned())
    };
    if param("state").as_deref() != Some(expected_state.as_str()) {
        respond(&mut stream, "400 Bad Request", &page(lang, false)).await;
        return None;
    }
    if let Some(err) = param("error") {
        respond(&mut stream, "200 OK", &page(lang, false)).await;
        return Some(Err(Error::Denied(err)));
    }
    if let Some(code) = param("code") {
        respond(&mut stream, "200 OK", &page(lang, true)).await;
        return Some(Ok(code));
    }
    respond(&mut stream, "400 Bad Request", &page(lang, false)).await;
    None
}

/// Waits until the browser comes back to 127.0.0.1 with the authorization code.
/// Each connection is handled separately, so a slow or foreign one doesn't hold up the browser.
async fn wait_for_code(listener: &TcpListener, expected_state: &str, lang: Lang) -> Result<String> {
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Result<String>>(1);
    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let (stream, _) = accepted?;
                let tx = tx.clone();
                let state = expected_state.to_owned();
                tokio::spawn(async move {
                    if let Some(result) = handle_redirect(stream, state, lang).await {
                        let _ = tx.send(result).await;
                    }
                });
            }
            Some(result) = rx.recv() => return result,
        }
    }
}

impl Auth {
    pub fn new(keyring_service: impl Into<String>) -> Self {
        Self {
            keyring_service: keyring_service.into(),
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(30))
                .build()
                .expect("HTTP client"),
            tokens: Mutex::new(HashMap::new()),
            pending: std::sync::Mutex::new(None),
        }
    }

    /// The sign-in tab got lost: open the same Google page again (same state and PKCE)
    pub fn reopen_sign_in(&self, app: &AppHandle) -> Result<()> {
        let url = self.pending.lock().ok().and_then(|p| p.as_ref().map(|p| p.url.clone()));
        let Some(url) = url else { return Ok(()) };
        app.opener()
            .open_url(url, None::<&str>)
            .map_err(|e| Error::Other(format!("Could not open the browser: {e}")))
    }

    /// The person changed their mind: sign_in stops waiting for the browser and returns Error::Cancelled
    pub fn cancel_sign_in(&self) {
        if let Ok(p) = self.pending.lock() {
            if let Some(p) = p.as_ref() {
                p.cancel.notify_one();
            }
        }
    }

    pub fn http(&self) -> &reqwest::Client {
        &self.http
    }

    /// Accounts in sign-in order and whether each has a valid sign-in
    pub fn accounts(&self, app: &AppHandle) -> Vec<AccountStatus> {
        config::load_accounts(app)
            .unwrap_or_default()
            .into_iter()
            .map(|a| AccountStatus {
                signed_in: stored_refresh_token(&self.keyring_service, &a.email).is_some(),
                email: a.email,
            })
            .collect()
    }

    /// account — whose refresh token to delete if Google no longer accepts it
    async fn post_token(&self, form: &[(&str, &str)], account: Option<&str>) -> Result<TokenResponse> {
        let resp = self.http.post(TOKEN_URL).form(form).send().await?;
        if resp.status().is_success() {
            return Ok(resp.json().await?);
        }
        let status = resp.status().as_u16();
        let err: TokenError = resp.json().await.unwrap_or(TokenError {
            error: "unknown".into(),
            error_description: None,
        });
        let failure = token_failure(status, err);
        if let (Error::NotSignedIn, Some(email)) = (&failure, account) {
            delete_refresh_token(&self.keyring_service, email);
        }
        Err(failure)
    }

    /// Sign in to one more account (or again to an already added one). Returns the email
    pub async fn sign_in(&self, app: &AppHandle) -> Result<String> {
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
            // select_account: Google lets you choose an account instead of silently signing in to the one open in the browser
            .append_pair("prompt", "select_account consent")
            // Google consent screen in the UI language, not the browser's
            .append_pair("hl", i18n::current(app).hl());

        let cancel = Arc::new(Notify::new());
        if let Ok(mut p) = self.pending.lock() {
            *p = Some(PendingSignIn {
                url: auth_url.to_string(),
                cancel: cancel.clone(),
            });
        }
        let guard = PendingGuard(&self.pending);

        app.opener()
            .open_url(auth_url.as_str(), None::<&str>)
            .map_err(|e| Error::Other(format!("Could not open the browser: {e}")))?;

        let code = wait_or_cancel(
            wait_for_code(&listener, &state, i18n::current(app)),
            &cancel,
            SIGN_IN_TIMEOUT,
        )
        .await?;
        // code received: from here there's nothing to cancel or reopen
        drop(guard);

        let tokens = self
            .exchange_code(&client, &code, &verifier, &redirect_uri)
            .await?;

        if !has_calendar_scopes(tokens.scope.as_deref().unwrap_or_default()) {
            return Err(Error::MissingScope);
        }
        let refresh = tokens
            .refresh_token
            .clone()
            .ok_or_else(|| Error::Other("Google did not return a refresh token".into()))?;
        // email is the account key: without it there's nothing to attach the token to
        let email = tokens
            .id_token
            .as_deref()
            .and_then(email_from_id_token)
            .ok_or_else(|| Error::Other("Google did not return the account email".into()))?;
        keyring_entry(&self.keyring_service, &keyring_user(&email))?.set_password(&refresh)?;

        let accounts = config::with_account(config::load_accounts(app).unwrap_or_default(), &email);
        config::save_accounts(app, &accounts)?;

        self.tokens.lock().await.insert(
            email.to_ascii_lowercase(),
            AccessToken::issued(tokens.access_token, tokens.expires_in, Instant::now()),
        );
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
        ], None)
        .await
    }

    /// A valid access token for the account; refreshes it if needed.
    /// Requests of different accounts wait for each other only during a token refresh.
    pub async fn access_token(&self, app: &AppHandle, account: &str) -> Result<String> {
        let key = account.to_ascii_lowercase();
        let mut guard = self.tokens.lock().await;
        if let Some(t) = guard.get(&key).filter(|t| t.is_fresh(Instant::now())) {
            return Ok(t.value.clone());
        }
        let refresh = stored_refresh_token(&self.keyring_service, account).ok_or(Error::NotSignedIn)?;
        let client = config::client(app)?;
        let tokens = self
            .post_token(
                &[
                    ("client_id", client.client_id.as_str()),
                    ("client_secret", client.client_secret.as_str()),
                    ("refresh_token", refresh.as_str()),
                    ("grant_type", "refresh_token"),
                ],
                Some(account),
            )
            .await?;
        let value = tokens.access_token.clone();
        guard.insert(key, AccessToken::issued(tokens.access_token, tokens.expires_in, Instant::now()));
        Ok(value)
    }

    pub async fn forget_access_token(&self, account: &str) {
        self.tokens.lock().await.remove(&account.to_ascii_lowercase());
    }

    /// Sign out of one account; None — of all
    pub async fn sign_out(&self, app: &AppHandle, account: Option<&str>) {
        let all = config::load_accounts(app).unwrap_or_default();
        let leaving: Vec<Account> = match account {
            Some(email) => all.iter().filter(|a| a.email.eq_ignore_ascii_case(email)).cloned().collect(),
            None => all.clone(),
        };
        for a in &leaving {
            if let Some(refresh) = stored_refresh_token(&self.keyring_service, &a.email) {
                // revoke access at Google; a network error is not considered fatal
                let _ = self
                    .http
                    .post(REVOKE_URL)
                    .form(&[("token", refresh.as_str())])
                    .send()
                    .await;
            }
            delete_refresh_token(&self.keyring_service, &a.email);
            self.forget_access_token(&a.email).await;
        }
        let rest = leaving.iter().fold(all, |list, a| config::without_account(list, &a.email));
        let _ = config::save_accounts(app, &rest);
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

    fn identifier(config: &str) -> String {
        let config: serde_json::Value = serde_json::from_str(config).unwrap();
        config["identifier"].as_str().unwrap().to_owned()
    }

    #[test]
    fn release_reads_sign_ins_saved_by_earlier_versions() {
        assert_eq!(identifier(include_str!("../tauri.conf.json")), "com.arseni.calmcalendar");
    }

    #[test]
    fn dev_build_keeps_sign_ins_apart_from_the_installed_app() {
        assert_ne!(
            identifier(include_str!("../tauri.dev.conf.json")),
            identifier(include_str!("../tauri.conf.json"))
        );
    }

    #[test]
    fn keyring_key_per_account_ignores_case() {
        assert_eq!(keyring_user("Me@Gmail.com"), "google-refresh-token:me@gmail.com");
        assert_ne!(keyring_user("a@b.com"), LEGACY_KEYRING_USER);
    }

    #[tokio::test]
    async fn silent_connection_does_not_block_browser() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let waiter = tokio::spawn(async move { wait_for_code(&listener, "st", Lang::En).await });

        // a foreign program connected and stays silent
        let _silent = TcpStream::connect(addr).await.unwrap();
        // a foreign request with a wrong state is ignored
        let mut wrong = TcpStream::connect(addr).await.unwrap();
        wrong.write_all(b"GET /?code=evil&state=bad HTTP/1.1\r\n\r\n").await.unwrap();
        // the browser comes next and doesn't wait for the silent connection
        let mut browser = TcpStream::connect(addr).await.unwrap();
        browser.write_all(b"GET /?code=good&state=st HTTP/1.1\r\n\r\n").await.unwrap();

        let code = tokio::time::timeout(Duration::from_secs(2), waiter).await.unwrap().unwrap().unwrap();
        assert_eq!(code, "good");
    }

    #[tokio::test]
    async fn sign_in_wait_can_be_cancelled() {
        let cancel = Notify::new();
        // "Cancel" was pressed before the wait started: the cancellation is not lost
        cancel.notify_one();
        let never = std::future::pending::<Result<String>>();
        let r = wait_or_cancel(never, &cancel, Duration::from_secs(5)).await;
        assert!(matches!(r, Err(Error::Cancelled)));
    }

    #[tokio::test]
    async fn sign_in_wait_returns_code_or_times_out() {
        let cancel = Notify::new();
        let code = wait_or_cancel(async { Ok("good".to_string()) }, &cancel, Duration::from_secs(5)).await;
        assert_eq!(code.unwrap(), "good");

        let never = std::future::pending::<Result<String>>();
        let r = wait_or_cancel(never, &cancel, Duration::from_millis(20)).await;
        assert!(matches!(r, Err(Error::Timeout)));
    }

    #[test]
    fn cancelled_error_reaches_the_interface_as_its_own_kind() {
        assert_eq!(Error::Cancelled.kind(), "cancelled");
    }

    /// Sends a request to handle_redirect over a real connection; returns its result and the response text
    async fn redirect(request: &[u8]) -> (Option<Result<String>>, String) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mut browser = TcpStream::connect(listener.local_addr().unwrap()).await.unwrap();
        let (stream, _) = listener.accept().await.unwrap();
        browser.write_all(request).await.unwrap();
        let result = handle_redirect(stream, "st".into(), Lang::En).await;
        let mut response = String::new();
        browser.read_to_string(&mut response).await.unwrap();
        (result, response)
    }

    #[tokio::test]
    async fn browser_gets_the_success_page_with_the_code() {
        let (result, response) = redirect(b"GET /?code=good&state=st HTTP/1.1\r\n\r\n").await;
        assert_eq!(result.unwrap().unwrap(), "good");
        let body = page(Lang::En, true);
        assert!(response.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(response.contains(&format!("Content-Length: {}\r\n", body.len())));
        assert!(response.ends_with(&body));
    }

    #[tokio::test]
    async fn refused_consent_ends_the_sign_in() {
        let (result, response) = redirect(b"GET /?error=access_denied&state=st HTTP/1.1\r\n\r\n").await;
        assert!(matches!(result, Some(Err(Error::Denied(e))) if e == "access_denied"));
        assert!(response.ends_with(&page(Lang::En, false)));
    }

    #[tokio::test]
    async fn other_requests_are_answered_and_ignored() {
        let (result, response) = redirect(b"GET /favicon.ico HTTP/1.1\r\n\r\n").await;
        assert!(result.is_none());
        assert!(response.starts_with("HTTP/1.1 404 Not Found\r\n"));
        for request in [&b"GET /?state=st HTTP/1.1\r\n\r\n"[..], b"GET /?code=x&state=other HTTP/1.1\r\n\r\n", b"GET :99999 HTTP/1.1\r\n\r\n"] {
            let (result, response) = redirect(request).await;
            assert!(result.is_none());
            assert!(response.starts_with("HTTP/1.1 400 Bad Request\r\n"));
        }
    }

    #[tokio::test]
    async fn request_line_may_arrive_in_parts() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mut browser = TcpStream::connect(listener.local_addr().unwrap()).await.unwrap();
        let (mut stream, _) = listener.accept().await.unwrap();
        browser.write_all(b"GET /?code=1").await.unwrap();
        let reader = tokio::spawn(async move { read_request_line(&mut stream).await });
        tokio::time::sleep(Duration::from_millis(50)).await;
        browser.write_all(b"&state=st HTTP/1.1\r\n").await.unwrap();
        browser.shutdown().await.unwrap();
        assert_eq!(reader.await.unwrap().as_deref(), Some("GET /?code=1&state=st HTTP/1.1"));
    }

    #[tokio::test]
    async fn endless_request_is_cut_at_16_kib() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mut browser = TcpStream::connect(listener.local_addr().unwrap()).await.unwrap();
        let (mut stream, _) = listener.accept().await.unwrap();
        browser.write_all(&[b'a'; 20 * 1024]).await.unwrap();
        let line = tokio::time::timeout(Duration::from_secs(2), read_request_line(&mut stream)).await.unwrap().unwrap();
        assert!((16 * 1024..20 * 1024).contains(&line.len()));
    }

    #[test]
    fn sign_in_page_follows_the_language_direction() {
        let arabic = page(Lang::Ar, true);
        assert!(arabic.contains("lang=ar dir=rtl"));
        assert!(arabic.contains(i18n::sign_in_page(Lang::Ar, true)));
        assert!(page(Lang::En, false).contains("lang=en dir=ltr"));
    }

    #[test]
    fn invalid_grant_means_signing_in_again() {
        let err = |error: &str, description: Option<&str>| TokenError {
            error: error.into(),
            error_description: description.map(str::to_owned),
        };
        assert!(matches!(token_failure(400, err("invalid_grant", None)), Error::NotSignedIn));
        assert!(matches!(
            token_failure(401, err("invalid_client", Some("The OAuth client was not found."))),
            Error::Google { status: 401, message } if message == "The OAuth client was not found."
        ));
        assert!(matches!(
            token_failure(500, err("server_error", None)),
            Error::Google { status: 500, message } if message == "server_error"
        ));
    }

    #[test]
    fn calendar_needs_every_requested_scope() {
        let all = format!("openid {} email", CALENDAR_SCOPES.join(" "));
        assert!(has_calendar_scopes(&all));
        assert!(!has_calendar_scopes(CALENDAR_SCOPES[0]));
        assert!(!has_calendar_scopes(""));
    }

    #[test]
    fn token_is_renewed_a_minute_before_it_expires() {
        let now = Instant::now();
        let token = |expires_in| AccessToken::issued(String::new(), expires_in, now);
        assert!(token(3600).is_fresh(now));
        assert!(token(61).is_fresh(now));
        assert!(!token(60).is_fresh(now));
        assert!(!token(0).is_fresh(now));
        assert!(!token(3600).is_fresh(now + Duration::from_secs(3600)));
    }

    #[test]
    fn pkce_strings_are_random_and_url_safe() {
        let a = random_string(64);
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_alphanumeric()));
        assert_ne!(a, random_string(64));
    }

    #[tokio::test]
    async fn cancel_reaches_the_pending_sign_in_and_the_guard_clears_it() {
        let auth = Auth::new("test");
        let cancel = Arc::new(Notify::new());
        *auth.pending.lock().unwrap() = Some(PendingSignIn { url: "u".into(), cancel: cancel.clone() });
        auth.cancel_sign_in();
        tokio::time::timeout(Duration::from_secs(1), cancel.notified()).await.unwrap();
        drop(PendingGuard(&auth.pending));
        assert!(auth.pending.lock().unwrap().is_none());
    }

    #[tokio::test]
    async fn forgetting_a_token_ignores_email_case() {
        let auth = Auth::new("test");
        let token = AccessToken { value: "t".into(), expires_at: Instant::now() };
        auth.tokens.lock().await.insert("me@gmail.com".into(), token);
        auth.forget_access_token("Me@Gmail.com").await;
        assert!(auth.tokens.lock().await.is_empty());
    }

    #[test]
    fn pkce_challenge_matches_rfc_example() {
        // example from RFC 7636, appendix B
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        assert_eq!(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }
}
