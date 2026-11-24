//! Subscriptions to .ics calendars by link (timetable, sports, a calendar from Outlook).
//! Rust downloads the file: another site usually won't serve it to a page (CORS). The UI parses it.
//! The user picks the subscription link themselves, Google is not involved, no new scopes needed.

use crate::error::{Error, Result};
use std::sync::OnceLock;
use std::time::Duration;

/// link calendars are never larger than this; protects against an accidental link to a huge file
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

/// webcal:// is the same link over https; schemes other than http and https are not accepted
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

/// Calendar text by link. Only the site address goes to the log, without the path: the path may contain a secret key
pub async fn fetch(url: &str) -> Result<String> {
    let url = normalize(url)?;
    let host = url.host_str().unwrap_or("").to_owned();
    // reqwest puts the whole link into the error text: it goes neither to the log nor to the UI
    let mut resp = http().get(url).send().await.map_err(|e| {
        let e = e.without_url();
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
    while let Some(chunk) = resp.chunk().await.map_err(|e| {
        let e = e.without_url();
        log::warn!("calendar feed {host}: {e}");
        Error::Network(e.to_string())
    })? {
        body.extend_from_slice(&chunk);
        if body.len() > MAX_BYTES {
            return Err(Error::Other("the calendar file is too large".into()));
        }
    }
    Ok(String::from_utf8_lossy(&body).into_owned())
}

#[cfg(test)]
mod tests {
    use super::{fetch, normalize};
    use crate::error::Error;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// One-request HTTP server on 127.0.0.1; returns the link to it
    async fn serve(head: impl Into<String>, body: Vec<u8>) -> String {
        let head = head.into();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/a.ics", listener.local_addr().unwrap());
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 4096];
            let _ = stream.read(&mut request).await;
            let _ = stream.write_all(head.as_bytes()).await;
            let _ = stream.write_all(&body).await;
            let _ = stream.shutdown().await;
        });
        url
    }

    const TEN_MIB: usize = 10 * 1024 * 1024;

    fn too_large(r: Result<String, Error>) -> bool {
        matches!(r, Err(Error::Other(m)) if m == "the calendar file is too large")
    }

    #[tokio::test]
    async fn returns_the_calendar_text() {
        let url = serve("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n", b"BEGIN:VCALENDAR".to_vec()).await;
        assert_eq!(fetch(&url).await.unwrap(), "BEGIN:VCALENDAR");
    }

    #[tokio::test]
    async fn http_error_is_reported_with_its_code() {
        let url = serve("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n", vec![]).await;
        assert!(matches!(fetch(&url).await, Err(Error::Other(m)) if m == "HTTP 404"));
    }

    #[tokio::test]
    async fn refuses_a_file_announced_as_too_large() {
        let head = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n", TEN_MIB + 1);
        assert!(too_large(fetch(&serve(head, vec![]).await).await));
    }

    #[tokio::test]
    async fn stops_reading_a_file_that_grows_too_large() {
        let head = "HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n";
        assert!(too_large(fetch(&serve(head, vec![b'a'; TEN_MIB + 1]).await).await));
    }

    #[tokio::test]
    async fn accepts_a_file_of_exactly_the_limit() {
        let head = format!("HTTP/1.1 200 OK\r\nContent-Length: {TEN_MIB}\r\n\r\n");
        assert_eq!(fetch(&serve(head, vec![b'a'; TEN_MIB]).await).await.unwrap().len(), TEN_MIB);
    }

    #[tokio::test]
    async fn introduces_itself_as_calm_calendar() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/a.ics", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = vec![0u8; 4096];
            let n = stream.read(&mut request).await.unwrap();
            stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n").await.unwrap();
            String::from_utf8_lossy(&request[..n]).to_lowercase()
        });
        fetch(&url).await.unwrap();
        let request = server.await.unwrap();
        assert!(request.contains(concat!("user-agent: calmcalendar/", env!("CARGO_PKG_VERSION"))));
    }

    #[tokio::test]
    async fn unreachable_site_is_a_network_error() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/a.ics", listener.local_addr().unwrap());
        drop(listener);
        assert!(matches!(fetch(&url).await, Err(Error::Network(_))));
    }

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

    /// over the network, so manual only: cargo test feeds -- --ignored
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
