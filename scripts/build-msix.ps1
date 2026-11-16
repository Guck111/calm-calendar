# Packs the built calm-calendar.exe into MSIX.
#
#   npx tauri build --no-bundle
#   .\scripts\build-msix.ps1                 # package .msix for upload to Partner Center
#   .\scripts\build-msix.ps1 -Register       # install from the folder without signing (needs Developer Mode)
#
# For the Store, Identity values come from Partner Center → Product identity.
# The Store package needs no signature: Microsoft signs it itself.

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
if (-not (Test-Path $exe)) { throw "No $exe. First run: npx tauri build --no-bundle" }

# MSIX version has four numbers; for the Store the last one must be 0
$semver = (Get-Content (Join-Path $tauri 'tauri.conf.json') -Raw | ConvertFrom-Json).version
$version = "$semver.0"

$out = Join-Path $tauri 'target\msix'
$layout = Join-Path $out 'layout'
# a package installed from the folder keeps the exe open: remove it before cleaning the folder
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
if (-not $makeappx) { throw 'No makeappx.exe: install the Windows SDK' }

$package = Join-Path $out "CalmCalendar_${version}_x64.msix"
& $makeappx.FullName pack /o /d $layout /p $package
if ($LASTEXITCODE) { throw "makeappx exited with code $LASTEXITCODE" }
Get-Item $package | Select-Object FullName, Length
