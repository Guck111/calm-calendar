//! Автозапуск при входе в Windows.
//!
//! Обычная сборка (NSIS, MSI): раздел Run в реестре через tauri-plugin-autostart,
//! приложение запускается с флагом --hidden.
//! Сборка MSIX: StartupTask из манифеста (src-tauri/msix/AppxManifest.xml).
//! Раздел Run ей не подходит: путь к exe внутри пакета меняется с каждым обновлением.
//! Аргументы StartupTask не передаёт, поэтому запуск при входе узнаём по виду активации.

use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

/// Включён ли автозапуск сейчас
pub fn is_enabled(app: &AppHandle) -> bool {
    if packaged::is_packaged() {
        packaged::is_enabled()
    } else {
        app.autolaunch().is_enabled().unwrap_or(false)
    }
}

/// Включает или выключает автозапуск. Возвращает состояние после попытки:
/// пользователь может запретить автозапуск в диспетчере задач, тогда включить его нельзя.
pub fn set_enabled(app: &AppHandle, enabled: bool) -> bool {
    if packaged::is_packaged() {
        return packaged::set_enabled(enabled);
    }
    let manager = app.autolaunch();
    let _ = if enabled { manager.enable() } else { manager.disable() };
    manager.is_enabled().unwrap_or(false)
}

/// Упакованное приложение запущено Windows при входе пользователя
pub fn launched_at_startup() -> bool {
    packaged::launched_at_startup()
}

#[cfg(windows)]
mod packaged {
    use windows::ApplicationModel::Activation::ActivationKind;
    use windows::ApplicationModel::{AppInstance, Package, StartupTask, StartupTaskState};
    use windows::core::{HSTRING, Result};

    /// TaskId из AppxManifest.xml
    const TASK_ID: &str = "CalmCalendarStartup";

    /// Вызовы WinRT ждут асинхронный ответ. Делаем это в отдельном потоке (MTA),
    /// а не в главном потоке окна (STA), где блокирующее ожидание нежелательно.
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
