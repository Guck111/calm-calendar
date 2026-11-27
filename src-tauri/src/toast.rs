//! Windows notification with a "Join" button. The Tauri notification plugin can't do buttons
//! that open a link, so we build such a notification ourselves. A button with
//! activationType="protocol" opens the link via Windows: it works from the Notification Center too,
//! and when the app is already closed.

use windows::core::HSTRING;
use windows::Data::Xml::Dom::XmlDocument;
use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};

/// A borrowed AppUserModelID for running from target\debug and target\release: an uninstalled build has none of its own.
/// The notification plugin does the same.
const POWERSHELL_APP_ID: &str = r"{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe";

fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// Notification XML: title, text and a button that opens the link
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

/// The same AppUserModelID as the notification plugin: in the installed app — identifier
fn app_id(identifier: &str) -> String {
    let exe_dir = tauri::utils::platform::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.display().to_string()));
    app_id_for(identifier, exe_dir.as_deref())
}

fn app_id_for(identifier: &str, exe_dir: Option<&str>) -> String {
    let dev = exe_dir.is_some_and(|dir| dir.ends_with(r"\target\debug") || dir.ends_with(r"\target\release"));
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

    #[test]
    fn escapes_every_xml_special_character() {
        assert_eq!(escape(r#"&<>"'"#), "&amp;&lt;&gt;&quot;&apos;");
    }

    #[test]
    fn uninstalled_build_borrows_the_powershell_app_id() {
        let id = "com.arseni.calmcalendar";
        assert_eq!(app_id_for(id, Some(r"C:\repo\src-tauri\target\debug")), POWERSHELL_APP_ID);
        assert_eq!(app_id_for(id, Some(r"C:\repo\src-tauri\target\release")), POWERSHELL_APP_ID);
        assert_eq!(app_id_for(id, Some(r"C:\Program Files\WindowsApps\Calm")), id);
        assert_eq!(app_id_for(id, None), id);
    }

    /// Shows a real notification: `cargo test toast::tests::shows -- --ignored`
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
