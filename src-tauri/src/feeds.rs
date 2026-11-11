//! Подписки на календари .ics по ссылке (расписание, спорт, календарь из Outlook).
//! Файл скачивает Rust: из страницы чужой сайт обычно не отдаётся (CORS). Разбирает его интерфейс.
//! Ссылку подписки выбирает сам пользователь, Google тут не участвует, новых прав не нужно.

use crate::error::{Error, Result};
use std::sync::OnceLock;
use std::time::Duration;

/// больше этого календари по ссылке не бывают; защищает от случайной ссылки на огромный файл
const MAX_BYTES: usize = 10 * 1024 * 1024;

fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .user_agent(concat!("CalmCalendar/", env!("CARGO_PKG_VERSION")))
            .build()
            .unwrap_or_default()
    })
}

/// webcal:// — та же ссылка по https; другие схемы, кроме http и https, не принимаем
pub fn normalize(url: &str) -> Result<url::Url> {
    let trimmed = url.trim();
    let fixed = match trimmed.get(..9) {
        Some(p) if p.eq_ignore_ascii_case("webcal://") => format!("https://{}", &trimmed[9..]),
        _ => trimmed.to_owned(),
    };
    let parsed = url::Url::parse(&fixed)?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        other => Err(Error::Other(format!("unsupported link scheme {other}"))),
    }
}

/// Текст календаря по ссылке. В журнал попадает только адрес сайта, без пути: в пути бывает секретный ключ
pub async fn fetch(url: &str) -> Result<String> {
    let url = normalize(url)?;
    let host = url.host_str().unwrap_or("").to_owned();
    let mut resp = http().get(url).send().await.map_err(|e| {
        log::warn!("calendar feed {host}: {e}");
        Error::Network(e.to_string())
    })?;
    let status = resp.status();
    if !status.is_success() {
        log::warn!("calendar feed {host}: HTTP {}", status.as_u16());
        return Err(Error::Other(format!("HTTP {}", status.as_u16())));
    }
    if resp.content_length().is_some_and(|n| n as usize > MAX_BYTES) {
        return Err(Error::Other("the calendar file is too large".into()));
    }
    let mut body = Vec::new();
    while let Some(chunk) = resp.chunk().await? {
        body.extend_from_slice(&chunk);
        if body.len() > MAX_BYTES {
            return Err(Error::Other("the calendar file is too large".into()));
        }
    }
    Ok(String::from_utf8_lossy(&body).into_owned())
}

#[cfg(test)]
mod tests {
    use super::normalize;

    #[test]
    fn webcal_becomes_https() {
        assert_eq!(normalize("webcal://example.com/a.ics").unwrap().as_str(), "https://example.com/a.ics");
        assert_eq!(normalize(" WEBCAL://example.com/a.ics ").unwrap().scheme(), "https");
    }

    #[test]
    fn http_and_https_pass() {
        assert!(normalize("http://example.com/a.ics").is_ok());
        assert!(normalize("https://example.com/a.ics").is_ok());
    }

    /// по сети, поэтому только вручную: cargo test feeds -- --ignored
    #[tokio::test]
    #[ignore]
    async fn downloads_a_public_calendar() {
        let text = super::fetch("webcal://calendar.google.com/calendar/ical/en.polish%23holiday%40group.v.calendar.google.com/public/basic.ics")
            .await
            .unwrap();
        assert!(text.contains("BEGIN:VCALENDAR"));
    }

    #[test]
    fn other_schemes_and_garbage_are_refused() {
        assert!(normalize("file:///C:/secret.ics").is_err());
        assert!(normalize("ftp://example.com/a.ics").is_err());
        assert!(normalize("not a link").is_err());
    }
}
