//! Narrow proxy to the Google Calendar API. Tokens never leave the Rust side:
//! the frontend passes only the method, path, parameters and request body.

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
        other => Err(Error::Other(format!("Method {other} is not supported"))),
    }
}

fn build_url(path: &str, query: &[(String, String)]) -> Result<Url> {
    let rejected = || Error::Other("API path is not allowed".into());
    // calendar and event ids are encoded whole, so dot segments,
    // backslashes, "?" and "#" can't be in the path — neither raw nor encoded
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
    // the final check is on the already parsed URL: the parser drops tabs and newlines and then resolves
    // the dot segments they hid. The scheme and host can't change: the path starts with "/" after a fixed base
    if !url.path().starts_with(ALLOWED_PREFIX) {
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
    Error::Google { status, message: error_message(&body) }
}

fn error_message(body: &Value) -> String {
    body.pointer("/error/message")
        .and_then(Value::as_str)
        .unwrap_or("unknown error")
        .to_owned()
}

pub async fn request(
    app: &AppHandle,
    auth: &Auth,
    account: &str,
    method: &str,
    path: &str,
    query: Vec<(String, String)>,
    body: Option<Value>,
) -> Result<Value> {
    let method = parse_method(method)?;
    let url = build_url(path, &query)?;

    // one retry if the token suddenly became invalid
    for attempt in 0..2 {
        let token = auth.access_token(app, account).await?;
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
            auth.forget_access_token(account).await;
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
            assert!(build_url(p, &[]).is_err(), "{p} must be rejected");
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

    #[test]
    fn accepts_only_the_methods_the_calendar_uses() {
        for (name, method) in [
            ("get", Method::GET),
            ("POST", Method::POST),
            ("patch", Method::PATCH),
            ("PUT", Method::PUT),
            ("Delete", Method::DELETE),
        ] {
            assert_eq!(parse_method(name).unwrap(), method);
        }
        assert!(matches!(parse_method("head"), Err(Error::Other(m)) if m == "Method HEAD is not supported"));
    }

    #[test]
    fn dot_segments_hidden_by_tabs_or_newlines_are_refused() {
        for p in ["/calendar/v3/.\t./.\t./oauth2/v2/userinfo", "/calendar/v3/.\n./.\r./x"] {
            assert!(build_url(p, &[]).is_err(), "{p:?} must be rejected");
        }
        assert!(build_url("/calendar/v3/a\t/b", &[]).is_ok_and(|u| u.path() == "/calendar/v3/a/b"));
    }

    /// each piece alone, in a path that would otherwise stay inside /calendar/v3/
    #[test]
    fn every_forbidden_piece_is_refused_on_its_own() {
        for p in [
            "/calendar/v3/a..b",
            "/calendar/v3/https://evil.com/x",
            "/calendar/v3/a/%2E%2e/b",
            "/calendar/v3/a\\b",
            "/calendar/v3/a?b",
            "/calendar/v3/a#b",
        ] {
            assert!(build_url(p, &[]).is_err(), "{p} must be rejected");
        }
    }

    #[test]
    fn no_query_leaves_no_question_mark() {
        let url = build_url("/calendar/v3/users/me/calendarList", &[]).unwrap();
        assert_eq!(url.as_str(), "https://www.googleapis.com/calendar/v3/users/me/calendarList");
    }

    #[test]
    fn google_error_text_is_passed_to_the_interface() {
        let body = serde_json::json!({ "error": { "code": 403, "message": "Rate Limit Exceeded" } });
        assert_eq!(error_message(&body), "Rate Limit Exceeded");
        assert_eq!(error_message(&Value::Null), "unknown error");
    }

    const TRICKY: [&str; 16] = ["..", ".", "%2e", "%2E", "%2f", "%2F", "/", "//", "\\", "?", "#", "@", ":", "a", "evil.com", "%00"];

    proptest::proptest! {
        /// whatever path the interface sends, the request stays on the Calendar API with nothing extra
        #[test]
        fn any_path_stays_inside_the_calendar_api(
            pieces in proptest::collection::vec(proptest::sample::select(TRICKY.to_vec()), 0..12),
            noise in "\\PC{0,12}",
        ) {
            let path = format!("/calendar/v3/{}{noise}", pieces.concat());
            if let Ok(url) = build_url(&path, &[]) {
                proptest::prop_assert_eq!(url.scheme(), "https");
                proptest::prop_assert_eq!(url.host_str(), Some("www.googleapis.com"));
                proptest::prop_assert!(url.path().starts_with(ALLOWED_PREFIX));
                proptest::prop_assert!(!url.path().split('/').any(|seg| seg == "." || seg == ".."));
                proptest::prop_assert_eq!(url.query(), None);
                proptest::prop_assert_eq!(url.fragment(), None);
            }
        }
    }

    /// series occurrences and its master event: needed for "this and following"
    #[test]
    fn allows_series_instances() {
        let url = build_url(
            "/calendar/v3/calendars/primary/events/abc123/instances",
            &[("showDeleted".into(), "true".into()), ("timeMax".into(), "2026-11-11T11:00:00.000Z".into())],
        )
        .unwrap();
        assert_eq!(url.path(), "/calendar/v3/calendars/primary/events/abc123/instances");
        assert!(url.as_str().contains("timeMax=2026-11-11T11%3A00%3A00.000Z"));
        assert!(build_url("/calendar/v3/calendars/primary/events/abc_20261111T110000Z", &[]).is_ok());
    }
}
