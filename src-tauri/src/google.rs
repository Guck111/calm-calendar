//! Узкий прокси к Google Calendar API. Токены не покидают Rust-часть:
//! фронтенд передаёт только метод, путь, параметры и тело запроса.

use crate::error::{Error, Result};
use crate::oauth::Auth;
use reqwest::Method;
use serde_json::Value;
use tauri::AppHandle;
use url::Url;

const API_BASE: &str = "https://www.googleapis.com";
const ALLOWED_PREFIX: &str = "/calendar/v3/";

fn parse_method(method: &str) -> Result<Method> {
    match method.to_ascii_uppercase().as_str() {
        "GET" => Ok(Method::GET),
        "POST" => Ok(Method::POST),
        "PATCH" => Ok(Method::PATCH),
        "PUT" => Ok(Method::PUT),
        "DELETE" => Ok(Method::DELETE),
        other => Err(Error::Other(format!("Метод {other} не поддерживается"))),
    }
}

fn build_url(path: &str, query: &[(String, String)]) -> Result<Url> {
    let rejected = || Error::Other("Недопустимый путь API".into());
    // идентификаторы календарей и событий кодируются целиком, поэтому точек-сегментов,
    // обратных слешей, «?» и «#» в пути быть не может — ни открытых, ни закодированных
    let lower = path.to_ascii_lowercase();
    if !path.starts_with(ALLOWED_PREFIX)
        || path.contains("..")
        || path.contains("://")
        || lower.contains("%2e")
        || lower.contains("%2f%2e")
        || path.contains('\\')
        || path.contains('?')
        || path.contains('#')
    {
        return Err(rejected());
    }
    let mut url = Url::parse(&format!("{API_BASE}{path}"))?;
    // окончательная проверка — по уже разобранному адресу, после нормализации пути
    if url.scheme() != "https"
        || url.host_str() != Some("www.googleapis.com")
        || !url.path().starts_with(ALLOWED_PREFIX)
        || url.path().split('/').any(|seg| seg == "." || seg == "..")
    {
        return Err(rejected());
    }
    if !query.is_empty() {
        url.query_pairs_mut().extend_pairs(query.iter());
    }
    Ok(url)
}

async fn google_error(resp: reqwest::Response) -> Error {
    let status = resp.status().as_u16();
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    let message = body
        .pointer("/error/message")
        .and_then(Value::as_str)
        .unwrap_or("неизвестная ошибка")
        .to_owned();
    Error::Google { status, message }
}

pub async fn request(
    app: &AppHandle,
    auth: &Auth,
    method: &str,
    path: &str,
    query: Vec<(String, String)>,
    body: Option<Value>,
) -> Result<Value> {
    let method = parse_method(method)?;
    let url = build_url(path, &query)?;

    // одна повторная попытка, если токен внезапно стал недействителен
    for attempt in 0..2 {
        let token = auth.access_token(app).await?;
        let mut req = auth
            .http()
            .request(method.clone(), url.clone())
            .bearer_auth(&token);
        if let Some(b) = &body {
            req = req.json(b);
        }
        let resp = req.send().await?;
        let status = resp.status();
        if status == reqwest::StatusCode::UNAUTHORIZED && attempt == 0 {
            auth.forget_access_token().await;
            continue;
        }
        if !status.is_success() {
            return Err(google_error(resp).await);
        }
        if status == reqwest::StatusCode::NO_CONTENT {
            return Ok(Value::Null);
        }
        let text = resp.text().await?;
        return Ok(if text.trim().is_empty() {
            Value::Null
        } else {
            serde_json::from_str(&text)?
        });
    }
    Err(Error::NotSignedIn)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_foreign_paths() {
        assert!(build_url("/oauth2/v1/userinfo", &[]).is_err());
        assert!(build_url("/calendar/v3/../../x", &[]).is_err());
        assert!(build_url("/calendar/v3/@evil.com/x", &[]).is_ok_and(|u| u.host_str() == Some("www.googleapis.com")));
    }

    #[test]
    fn rejects_encoded_dot_segments() {
        for p in [
            "/calendar/v3/%2e%2e/%2e%2e/oauth2/v2/userinfo",
            "/calendar/v3/%2E%2E/x",
            "/calendar/v3/.%2e/x",
            "/calendar/v3/calendars\\..\\x",
            "/calendar/v3/x?alt=media",
            "/calendar/v3/x#frag",
        ] {
            assert!(build_url(p, &[]).is_err(), "{p} должен отклоняться");
        }
    }

    #[test]
    fn keeps_encoded_calendar_id() {
        let url = build_url(
            "/calendar/v3/calendars/en.polish%23holiday%40group.v.calendar.google.com/events",
            &[("singleEvents".into(), "true".into())],
        )
        .unwrap();
        assert!(url.as_str().contains("en.polish%23holiday%40group"));
        assert!(url.as_str().ends_with("?singleEvents=true"));
    }
}
