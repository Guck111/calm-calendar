# MSIX package for Microsoft Store

Tauri builds only `.exe` and `.msi`. For the Store we wrap the release `calm-calendar.exe` into an MSIX ourselves: Microsoft signs MSIX packages submitted to the Store, so no code signing certificate is needed, and the Store delivers updates.

```powershell
npx tauri build --no-bundle          # with CALM_GOOGLE_CLIENT_ID / CALM_GOOGLE_CLIENT_SECRET set
.\scripts\build-msix.ps1 -IdentityName <from Partner Center> -Publisher "CN=<from Partner Center>" -PublisherDisplayName <from Partner Center>
```

The package goes to `src-tauri\target\msix\`. Manifest template: `src-tauri\msix\AppxManifest.xml`.

## Local testing

Turn on Developer Mode (Settings → System → For developers), then:

```powershell
.\scripts\build-msix.ps1 -Register
Start-Process "shell:AppsFolder\CalmCalendar.Dev_nfw2ntm5m5jmm!com.arseni.calmcalendar"
```

`-Register` installs the unsigned package straight from the folder. Quit the regular (NSIS) install first: single-instance forwards the launch to it otherwise.

## Spike results (2026-11-08, Windows 11 26300)

| Check | Result |
|---|---|
| Package builds with `makeappx`, installs with `Add-AppxPackage -Register` | works |
| Size | 3.3 MB (the Tauri `.exe` route for the Store needs the offline WebView2 installer, about +127 MB) |
| Sign-in through the browser, code received on `127.0.0.1` | works: a full-trust package has no loopback restriction |
| Refresh token in Windows Credential Manager | works, shared with the unpackaged build (same target name) |
| Settings in `%APPDATA%\com.arseni.calmcalendar` | read from the real folder |
| Reminders as Windows notifications | work. The plugin sends them as `<PackageFamilyName>!<identifier>`, so the manifest `Application Id` must equal `identifier` from `tauri.conf.json` |
| `windows.startupTask` | `StartupTask.RequestEnableAsync()` enables it without a prompt, `Disable()` turns it off |
| Autostart through `tauri-plugin-autostart` (HKCU `Run`) | the value lands in the real registry, but it points to the exe inside the versioned package folder, which changes with every update. Not usable for the packaged build |

## Autostart

`src-tauri/src/autostart.rs` picks the mechanism at runtime: inside a package (`Package::Current()` succeeds) the tray item drives the `CalmCalendarStartup` startup task, otherwise the `Run` key through the plugin. A startup task cannot pass `--hidden`, so the packaged build checks `AppInstance::GetActivatedEventArgs()` for `ActivationKind::StartupTask` and then shows only the widget.

Verified in the package: the tray item turns the task on (`State = Enabled`), nothing is written to `Run`, a normal launch still opens the main window. If the user disabled the app in Task Manager → Startup apps, `RequestEnableAsync` returns `DisabledByUser` and the tray check mark goes back off.

## To do before submission

- Identity values from Partner Center → Product identity.
- CI job that builds the MSIX on a version tag.
- Run Windows App Certification Kit on the package.
