# One-time setup for building the Xeno Garden Android app on this PC, with no Expo account
# (implementation_plan P10.10, ADR-019).
#
#   powershell -ExecutionPolicy Bypass -File tools/android/setup.ps1
#
# Downloads a portable JDK 17 and the Android SDK into %LOCALAPPDATA%\xeno-android (outside the
# repo, nothing installed system-wide), then installs exactly the SDK parts the app needs.
# Safe to re-run: finished steps are skipped.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is ~10x faster without the progress bar

$root = Join-Path $env:LOCALAPPDATA 'xeno-android'
$jdkDir = Join-Path $root 'jdk'
$sdkDir = Join-Path $root 'sdk'
$dl = Join-Path $root 'downloads'
New-Item -ItemType Directory -Force $root, $dl, $sdkDir | Out-Null

# Versions required by Expo SDK 57 / React Native 0.86 (react-native/gradle/libs.versions.toml).
$packages = @(
  'platform-tools',
  'platforms;android-36',
  'build-tools;36.0.0',
  'ndk;27.1.12297006',
  'cmake;3.22.1'
)
$jdkUrl = 'https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse'
$toolsUrl = 'https://dl.google.com/android/repository/commandlinetools-win-13114758_latest.zip'

function Get-Zip($url, $zip, $dest) {
  if (-not (Test-Path $zip)) {
    Write-Host "Downloading $url"
    Invoke-WebRequest -Uri $url -OutFile "$zip.part" -UseBasicParsing
    Move-Item "$zip.part" $zip
  }
  Write-Host "Unpacking $(Split-Path $zip -Leaf)"
  Expand-Archive -Path $zip -DestinationPath $dest -Force
}

# 1. JDK 17 (Eclipse Temurin)
$javaExe = Get-ChildItem -Path $jdkDir -Filter java.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $javaExe) {
  Get-Zip $jdkUrl (Join-Path $dl 'jdk17.zip') $jdkDir
  $javaExe = Get-ChildItem -Path $jdkDir -Filter java.exe -Recurse | Select-Object -First 1
}
$javaHome = Split-Path (Split-Path $javaExe.FullName -Parent) -Parent
Write-Host "JDK: $javaHome"

# 2. Android command-line tools (must live in cmdline-tools\latest)
$sdkmanager = Join-Path $sdkDir 'cmdline-tools\latest\bin\sdkmanager.bat'
if (-not (Test-Path $sdkmanager)) {
  $tmp = Join-Path $root 'cmdline-tmp'
  Get-Zip $toolsUrl (Join-Path $dl 'cmdline-tools.zip') $tmp
  New-Item -ItemType Directory -Force (Join-Path $sdkDir 'cmdline-tools') | Out-Null
  $target = Join-Path $sdkDir 'cmdline-tools\latest'
  if (Test-Path $target) { Remove-Item -Recurse -Force $target }
  Move-Item (Join-Path $tmp 'cmdline-tools') $target
  Remove-Item -Recurse -Force $tmp
}

# 3. SDK packages (+ licences)
$env:JAVA_HOME = $javaHome
$env:ANDROID_HOME = $sdkDir
$env:Path = "$javaHome\bin;$env:Path"

# sdkmanager is a .bat that reads answers from stdin: give it a real file (piping from PowerShell
# doesn't reach it) and keep its log, so a failure is never silent.
function Invoke-SdkManager([string[]]$sdkArgs, [string]$logName, [string]$stdin) {
  $log = Join-Path $root $logName
  $params = @{
    FilePath = $sdkmanager
    ArgumentList = @("--sdk_root=`"$sdkDir`"") + $sdkArgs
    RedirectStandardOutput = $log
    NoNewWindow = $true
    Wait = $true
    PassThru = $true
  }
  if ($stdin) { $params.RedirectStandardInput = $stdin }
  $proc = Start-Process @params
  if ($proc.ExitCode -ne 0) { throw "sdkmanager $($sdkArgs -join ' ') failed (exit $($proc.ExitCode)); see $log" }
}

Write-Host 'Accepting Android SDK licences'
$yesFile = Join-Path $root 'yes.txt'
[IO.File]::WriteAllText($yesFile, ("y`r`n" * 50))
Invoke-SdkManager @('--licenses') 'licences.log' $yesFile
if (-not (Test-Path (Join-Path $sdkDir 'licenses\android-sdk-license'))) { throw 'Android SDK licences were not accepted' }

$missing = $packages | Where-Object { -not (Test-Path (Join-Path $sdkDir ($_ -replace ';', '\'))) }
if ($missing) {
  Write-Host "Installing $($missing -join ', ') (the NDK alone is ~1 GB)"
  Invoke-SdkManager $missing 'install.log' $null
}
foreach ($p in $packages) {
  if (-not (Test-Path (Join-Path $sdkDir ($p -replace ';', '\')))) { throw "$p is still missing after install" }
  Write-Host "OK  $p"
}

@{ javaHome = $javaHome; androidHome = $sdkDir } | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $root 'paths.json')
Write-Host ''
Write-Host "Android toolchain ready in $root"
Write-Host 'Next: npm run android:apk'
