# Downloads Microsoft Edge WebDriver of the same version as the installed WebView2 runtime, for the app tests
# (tauri-driver drives the app through it). Result: e2e\.drivers\msedgedriver.exe
# Usage: powershell -ExecutionPolicy Bypass -File scripts/msedgedriver.ps1
$ErrorActionPreference = "Stop"

$keys = @(
  "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
  "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
  "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
)
$version = $null
foreach ($key in $keys) {
  if (Test-Path $key) {
    $version = (Get-ItemProperty $key).pv
    if ($version) { break }
  }
}
if (-not $version) { throw "WebView2 runtime not found" }

$dir = Join-Path $PSScriptRoot "..\e2e\.drivers"
$exe = Join-Path $dir "msedgedriver.exe"
$stamp = Join-Path $dir "version.txt"
if ((Test-Path $exe) -and (Test-Path $stamp) -and ((Get-Content $stamp) -eq $version)) {
  Write-Output "msedgedriver $version is already there"
  exit 0
}

New-Item -ItemType Directory -Force $dir | Out-Null
$zip = Join-Path $dir "edgedriver_win64.zip"
$url = "https://msedgedriver.microsoft.com/$version/edgedriver_win64.zip"
Write-Output "Downloading msedgedriver $version from $url"
Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
Expand-Archive -Path $zip -DestinationPath $dir -Force
Remove-Item $zip
Set-Content -Path $stamp -Value $version
Write-Output "msedgedriver $version -> $exe"
