# Упаковывает собранный calm-calendar.exe в MSIX.
#
#   npx tauri build --no-bundle
#   .\scripts\build-msix.ps1                 # пакет .msix для загрузки в Partner Center
#   .\scripts\build-msix.ps1 -Register       # установить из папки без подписи (нужен режим разработчика)
#
# Для Store значения Identity берутся из Partner Center → Product identity.
# Подпись пакета для Store не нужна: Microsoft подписывает его сама.

param(
    [string]$IdentityName = 'CalmCalendar.Dev',
    [string]$Publisher = 'CN=CalmCalendarDev',
    [string]$PublisherDisplayName = 'Arseni',
    [switch]$Register
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$tauri = Join-Path $root 'src-tauri'
$exe = Join-Path $tauri 'target\release\calm-calendar.exe'
if (-not (Test-Path $exe)) { throw "Нет $exe. Сначала: npx tauri build --no-bundle" }

# в MSIX версия из четырёх чисел, последнее для Store должно быть 0
$semver = (Get-Content (Join-Path $tauri 'tauri.conf.json') -Raw | ConvertFrom-Json).version
$version = "$semver.0"

$out = Join-Path $tauri 'target\msix'
$layout = Join-Path $out 'layout'
# установленный из папки пакет держит exe открытым: снимаем его до очистки папки
if ($Register) { Get-AppxPackage -Name $IdentityName | Remove-AppxPackage }
if (Test-Path $layout) { Remove-Item $layout -Recurse -Force }
New-Item -ItemType Directory -Force (Join-Path $layout 'Assets') | Out-Null

Copy-Item $exe $layout
foreach ($icon in 'StoreLogo.png', 'Square150x150Logo.png', 'Square44x44Logo.png') {
    Copy-Item (Join-Path $tauri "icons\$icon") (Join-Path $layout 'Assets')
}

$manifest = (Get-Content (Join-Path $tauri 'msix\AppxManifest.xml') -Raw).
    Replace('{{IDENTITY_NAME}}', $IdentityName).
    Replace('{{PUBLISHER}}', $Publisher).
    Replace('{{PUBLISHER_DISPLAY_NAME}}', $PublisherDisplayName).
    Replace('{{VERSION}}', $version)
Set-Content (Join-Path $layout 'AppxManifest.xml') $manifest -Encoding UTF8

if ($Register) {
    Add-AppxPackage -Register (Join-Path $layout 'AppxManifest.xml')
    Get-AppxPackage -Name $IdentityName | Select-Object Name, Version, PackageFamilyName, InstallLocation
    return
}

$makeappx = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\makeappx.exe" |
    Sort-Object FullName -Descending | Select-Object -First 1
if (-not $makeappx) { throw 'Нет makeappx.exe: поставь Windows SDK' }

$package = Join-Path $out "CalmCalendar_${version}_x64.msix"
& $makeappx.FullName pack /o /d $layout /p $package
if ($LASTEXITCODE) { throw "makeappx завершился с кодом $LASTEXITCODE" }
Get-Item $package | Select-Object FullName, Length
