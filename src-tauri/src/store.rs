//! Rating in Microsoft Store: the Store's own "Rate and review" dialog over the main window.
//!
//! Only the Store build has it: an MSIX package signed by the Store. The installers from GitHub
//! and a package registered by hand for testing never ask.
//! Windows refuses the dialog for some installs (no Store account, an elevated app):
//! then the app's review page opens in the Store app instead.

use tauri::AppHandle;

/// Partner Center → Product identity → Store ID
const PRODUCT_ID: &str = "9N5HZ8P1QRMW";

/// The app's review page in the Store app
fn review_uri() -> String {
    format!("ms-windows-store://review/?ProductId={PRODUCT_ID}")
}

/// Installed from Microsoft Store
pub fn is_store_build() -> bool {
    dialog::is_store_build()
}

/// Asks the Store to show the rating dialog; falls back to the review page in the Store app
pub fn request_rating(app: &AppHandle) {
    dialog::request(app);
}

#[cfg(windows)]
mod dialog {
    use super::review_uri;
    use tauri::{AppHandle, Manager};
    use tauri_plugin_opener::OpenerExt;
    use windows::ApplicationModel::{Package, PackageSignatureKind};
    use windows::Services::Store::{StoreContext, StoreRateAndReviewStatus};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Shell::IInitializeWithWindow;
    use windows::core::{Interface, Result};

    pub fn is_store_build() -> bool {
        Package::Current()
            .and_then(|package| package.SignatureKind())
            .is_ok_and(|kind| kind == PackageSignatureKind::Store)
    }

    fn open_review_page(app: &AppHandle) {
        if let Err(e) = app.opener().open_url(review_uri(), None::<&str>) {
            log::warn!("store review page did not open: {e}");
        }
    }

    /// A desktop app has to name the window the Store dialog belongs to
    fn show(owner: HWND, failed: impl FnOnce() + Send + 'static) -> Result<()> {
        let context = StoreContext::GetDefault()?;
        unsafe { context.cast::<IInitializeWithWindow>()?.Initialize(owner)? };
        context.RequestRateAndReviewAppAsync()?.when(move |result| match result.and_then(|r| r.Status()) {
            Ok(status) if status != StoreRateAndReviewStatus::Error => {
                log::info!("store rating dialog closed with status {}", status.0);
            }
            other => {
                log::warn!("store rating dialog failed: {other:?}");
                failed();
            }
        })
    }

    pub fn request(app: &AppHandle) {
        let handle = app.clone();
        // the Store shows the dialog only when asked from the thread of the window
        let queued = app.run_on_main_thread(move || {
            let fallback = handle.clone();
            let shown = handle
                .get_webview_window("main")
                .and_then(|window| window.hwnd().ok())
                .map(|hwnd| show(HWND(hwnd.0 as _), move || open_review_page(&fallback)));
            if !matches!(shown, Some(Ok(()))) {
                log::warn!("store rating dialog was not shown: {shown:?}");
                open_review_page(&handle);
            }
        });
        if let Err(e) = queued {
            log::warn!("store rating was not requested: {e}");
        }
    }
}

#[cfg(not(windows))]
mod dialog {
    use tauri::AppHandle;

    pub fn is_store_build() -> bool {
        false
    }

    pub fn request(_app: &AppHandle) {}
}

#[cfg(test)]
mod tests {
    use super::{is_store_build, review_uri};

    #[test]
    fn review_page_is_the_apps_page_in_the_store() {
        assert_eq!(review_uri(), "ms-windows-store://review/?ProductId=9N5HZ8P1QRMW");
    }

    #[test]
    fn a_build_outside_a_store_package_is_not_a_store_build() {
        assert!(!is_store_build());
    }
}
