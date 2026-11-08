//! Уведомление Windows с кнопкой «Подключиться». Плагин уведомлений Tauri не умеет кнопки,
//! которые открывают ссылку, поэтому такое уведомление собираем сами. Кнопка с
//! activationType="protocol" открывает ссылку силами Windows: работает и из Центра уведомлений,
//! и когда приложение уже закрыто.

use windows::core::HSTRING;
use windows::Data::Xml::Dom::XmlDocument;
use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};

/// Чужой AppUserModelID для запуска из target\debug и target\release: у неустановленной сборки своего нет.
/// Плагин уведомлений поступает так же.
const POWERSHELL_APP_ID: &str = r"{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe";

fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// XML уведомления: название, текст и кнопка, которая открывает ссылку
pub fn xml(title: &str, body: &str, button: &str, url: &str) -> String {
    format!(
        "<toast><visual><binding template=\"ToastGeneric\"><text>{}</text><text>{}</text></binding></visual>\
<actions><action content=\"{}\" activationType=\"protocol\" arguments=\"{}\"/></actions></toast>",
        escape(title),
        escape(body),
        escape(button),
        escape(url)
    )
}

/// Тот же AppUserModelID, что у плагина уведомлений: в установленном приложении — identifier
fn app_id(identifier: &str) -> String {
    let dev = tauri::utils::platform::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.display().to_string()))
        .is_some_and(|dir| dir.ends_with(r"\target\debug") || dir.ends_with(r"\target\release"));
    if dev { POWERSHELL_APP_ID.to_owned() } else { identifier.to_owned() }
}

pub fn show_with_link(identifier: &str, title: &str, body: &str, button: &str, url: &str) -> windows::core::Result<()> {
    let doc = XmlDocument::new()?;
    doc.LoadXml(&HSTRING::from(xml(title, body, button, url)))?;
    let toast = ToastNotification::CreateToastNotification(&doc)?;
    ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(app_id(identifier)))?.Show(&toast)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_text_and_link() {
        let x = xml("Q&A <team>", "In 5 min", "Join", "https://zoom.us/j/1?pwd=a&b=\"c\"");
        assert!(x.contains("<text>Q&amp;A &lt;team&gt;</text>"));
        assert!(x.contains("arguments=\"https://zoom.us/j/1?pwd=a&amp;b=&quot;c&quot;\""));
        assert!(x.contains("activationType=\"protocol\""));
    }

    /// Показывает настоящее уведомление: `cargo test toast::tests::shows -- --ignored`
    #[test]
    #[ignore]
    fn shows() {
        show_with_link(
            "com.arseni.calmcalendar",
            "Calm Calendar: test",
            "Starting now · Join opens calmcalendar.co.uk",
            "Join",
            "https://calmcalendar.co.uk/",
        )
        .unwrap();
    }
}
