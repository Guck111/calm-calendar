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

## Release build

The `release` workflow builds the MSIX next to the `.exe` and `.msi` when the repository has these variables (Settings → Secrets and variables → Actions → Variables), all taken from Partner Center → Product identity:

| Variable | Example |
|---|---|
| `MSIX_IDENTITY_NAME` | `12345Arseni.CalmCalendar` |
| `MSIX_PUBLISHER` | `CN=ABCDEF12-3456-7890-ABCD-EF1234567890` |
| `MSIX_PUBLISHER_DISPLAY_NAME` | `Arseni` |

The OAuth client comes from the `CALM_GOOGLE_CLIENT_ID` and `CALM_GOOGLE_CLIENT_SECRET` secrets, as for the installers. Without them the Store build would ask users for their own client.

## Certification check

Partner Center runs the certification tests on every submission. To run them locally first, open an elevated PowerShell:

```powershell
$ack = "${env:ProgramFiles(x86)}\Windows Kits\App Certification Kitppcert.exe"
& $ack reset
& $ack test -appxpackagepath .\src-tauri	arget\msix\CalmCalendar_0.1.0.0_x64.msix -reportoutputpath $env:TEMP\wack.xml
```

The kit installs the package, so it has to be signed with a certificate the machine trusts; the unsigned local build is for `-Register` testing only.

## To do before submission

- Identity values from Partner Center → Product identity, as repository variables.
