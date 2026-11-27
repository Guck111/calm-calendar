//! Autostart at Windows sign-in.
//!
//! Regular build (NSIS, MSI): the current user's Run registry key, the app starts with the --hidden flag.
//! Only the user's key, even when the app runs as administrator: the default of auto-launch writes the
//! machine's key then, and the app would start for everyone who signs in to the computer.
//! MSIX build: StartupTask from the manifest (src-tauri/msix/AppxManifest.xml).
//! The Run key doesn't suit it: the exe path inside the package changes with every update.
//! StartupTask passes no arguments, so a sign-in launch is detected by the activation kind.

use auto_launch::{AutoLaunch, AutoLaunchBuilder, WindowsEnableMode};
use tauri::{AppHandle, Manager};

use crate::windowing::HIDDEN_ARG;

/// The Run key entry of the regular build
struct Launcher(AutoLaunch);

fn launcher(name: &str, exe: &str) -> Option<AutoLaunch> {
    AutoLaunchBuilder::new()
        .set_app_name(name)
        .set_app_path(exe)
        .set_args(&[HIDDEN_ARG])
        .set_windows_enable_mode(WindowsEnableMode::CurrentUser)
        .build()
        .ok()
}

pub fn setup(app: &AppHandle) {
    let exe = std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_default();
    match launcher(&app.package_info().name, &exe) {
        Some(l) => {
            app.manage(Launcher(l));
        }
        None => log::warn!("autostart: no launcher for {exe}"),
    }
}

/// Whether autostart is on now
pub fn is_enabled(app: &AppHandle) -> bool {
    if packaged::is_packaged() {
        packaged::is_enabled()
    } else {
        app.try_state::<Launcher>().is_some_and(|l| l.0.is_enabled().unwrap_or(false))
    }
}

/// Turns autostart on or off. Returns the state after the attempt:
/// the user can disable autostart in Task Manager, then it can't be turned on.
pub fn set_enabled(app: &AppHandle, enabled: bool) -> bool {
    if packaged::is_packaged() {
        return packaged::set_enabled(enabled);
    }
    let Some(launcher) = app.try_state::<Launcher>() else { return false };
    let _ = if enabled { launcher.0.enable() } else { launcher.0.disable() };
    launcher.0.is_enabled().unwrap_or(false)
}

/// The packaged app was started by Windows at user sign-in
pub fn launched_at_startup() -> bool {
    packaged::launched_at_startup()
}

#[cfg(windows)]
mod packaged {
    use windows::ApplicationModel::Activation::ActivationKind;
    use windows::ApplicationModel::{AppInstance, Package, StartupTask, StartupTaskState};
    use windows::core::{HSTRING, Result};

    /// TaskId from AppxManifest.xml
    const TASK_ID: &str = "CalmCalendarStartup";

    /// WinRT calls wait for an async response. Do it in a separate thread (MTA),
    /// not in the window's main thread (STA), where blocking waits are undesirable.
    fn off_ui_thread<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Option<T> {
        std::thread::spawn(f).join().ok()
    }

    fn task() -> Result<StartupTask> {
        StartupTask::GetAsync(&HSTRING::from(TASK_ID))?.join()
    }

    fn is_on(state: StartupTaskState) -> bool {
        state == StartupTaskState::Enabled || state == StartupTaskState::EnabledByPolicy
    }

    pub fn is_packaged() -> bool {
        off_ui_thread(|| Package::Current().is_ok()).unwrap_or(false)
    }

    pub fn is_enabled() -> bool {
        off_ui_thread(|| task().and_then(|t| t.State()).map(is_on).unwrap_or(false)).unwrap_or(false)
    }

    pub fn set_enabled(enabled: bool) -> bool {
        off_ui_thread(move || {
            let task = task()?;
            if enabled {
                task.RequestEnableAsync()?.join().map(is_on)
            } else {
                task.Disable()?;
                task.State().map(is_on)
            }
        })
        .and_then(|r| r.ok())
        .unwrap_or(false)
    }

    pub fn launched_at_startup() -> bool {
        off_ui_thread(|| {
            AppInstance::GetActivatedEventArgs()
                .and_then(|args| args.Kind())
                .is_ok_and(|kind| kind == ActivationKind::StartupTask)
        })
        .unwrap_or(false)
    }
}

#[cfg(not(windows))]
mod packaged {
    pub fn is_packaged() -> bool {
        false
    }
    pub fn is_enabled() -> bool {
        false
    }
    pub fn set_enabled(_enabled: bool) -> bool {
        false
    }
    pub fn launched_at_startup() -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::launcher;

    #[test]
    fn the_launch_entry_starts_the_app_hidden() {
        let l = launcher("Calm Calendar", r"C:\Apps\calm-calendar.exe").expect("a launcher");
        assert_eq!(l.get_app_name(), "Calm Calendar");
        assert_eq!(l.get_app_path(), r"C:\Apps\calm-calendar.exe");
        assert_eq!(l.get_args(), ["--hidden"]);
    }
}
