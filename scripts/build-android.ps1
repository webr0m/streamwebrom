param(
    [string]$Sdk = $env:ANDROID_HOME,
    [string]$JavaHome = $env:JAVA_HOME,
    [string]$OutDir = "",
    [string]$DebugKeystore = ""
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
if (!$Sdk) { $Sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (!$JavaHome) { throw 'Set JAVA_HOME to a JDK 17+ directory' }
if (!$OutDir) { $OutDir = Join-Path $root 'dist' }
if (!$DebugKeystore) { $DebugKeystore = Join-Path $env:USERPROFILE '.android\debug.keystore' }
$tools = Join-Path $Sdk 'build-tools\35.0.0'
$androidJar = Join-Path $Sdk 'platforms\android-35\android.jar'
foreach ($required in @("$JavaHome\bin\javac.exe", "$tools\aapt2.exe", "$tools\lib\d8.jar", $androidJar)) {
    if (!(Test-Path -LiteralPath $required)) { throw "Missing build tool: $required" }
}
function Run([string]$exe, [string[]]$arguments) {
    & $exe @arguments
    if ($LASTEXITCODE -ne 0) { throw "Build failed: $exe (exit $LASTEXITCODE)" }
}
$app = Join-Path $root 'mobile\android\app\src\main'
$build = Join-Path $root 'mobile\android\app\build\direct'
New-Item -ItemType Directory -Force $build, "$build\classes", "$build\dex", $OutDir | Out-Null
Run "$tools\aapt2.exe" @('compile', '--dir', "$app\res", '-o', "$build\resources.zip")
$manifest = (Get-Content -Raw "$app\AndroidManifest.xml").Replace('<manifest xmlns:', '<manifest package="lat.webrom.streamwebrom" xmlns:')
$manifest | Set-Content -Encoding utf8 "$build\AndroidManifest.xml"
$gradle = Get-Content -Raw (Join-Path $root 'mobile/android/app/build.gradle')
$versionCode = [regex]::Match($gradle, 'versionCode\s+(\d+)').Groups[1].Value
$versionName = [regex]::Match($gradle, "versionName\s+'([^']+)'").Groups[1].Value
if (!$versionCode -or !$versionName) { throw 'Cannot read Android app version from build.gradle' }
Run "$tools\aapt2.exe" @('link', '-I', $androidJar, '--manifest', "$build\AndroidManifest.xml", '--min-sdk-version', '26', '--target-sdk-version', '35', '--version-code', $versionCode, '--version-name', $versionName, '-o', "$build\base.apk", '-R', "$build\resources.zip")
$sources = @(Get-ChildItem "$app\java" -Recurse -Filter '*.java' | ForEach-Object FullName)
Run "$JavaHome\bin\javac.exe" (@('--release', '17', '-encoding', 'UTF-8', '-classpath', $androidJar, '-d', "$build\classes") + $sources)
$classes = @(Get-ChildItem "$build\classes" -Recurse -Filter '*.class' | ForEach-Object FullName)
Run "$JavaHome\bin\java.exe" (@('-cp', "$tools\lib\d8.jar", 'com.android.tools.r8.D8', '--release', '--min-api', '26', '--lib', $androidJar, '--output', "$build\dex") + $classes)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open("$build\base.apk", [System.IO.Compression.ZipArchiveMode]::Update)
try {
    Get-ChildItem "$build\dex" -Filter '*.dex' | ForEach-Object {
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $_.Name) | Out-Null
    }
} finally { $zip.Dispose() }
$unsigned = Join-Path $OutDir 'StreamWebRom-Android-unsigned.apk'
$debug = Join-Path $OutDir 'StreamWebRom-Android-debug.apk'
Run "$tools\zipalign.exe" @('-f', '-p', '4', "$build\base.apk", $unsigned)
if (!(Test-Path -LiteralPath $DebugKeystore)) {
    New-Item -ItemType Directory -Force (Split-Path $DebugKeystore -Parent) | Out-Null
    Run "$JavaHome\bin\keytool.exe" @('-genkeypair', '-keystore', $DebugKeystore, '-storepass', 'android', '-keypass', 'android', '-alias', 'androiddebugkey', '-dname', 'CN=Android Debug,O=Android,C=US', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000')
}
Run "$JavaHome\bin\java.exe" @('-jar', "$tools\lib\apksigner.jar", 'sign', '--ks', $DebugKeystore, '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--ks-key-alias', 'androiddebugkey', '--out', $debug, $unsigned)
Run "$JavaHome\bin\java.exe" @('-jar', "$tools\lib\apksigner.jar", 'verify', '--verbose', $debug)
Write-Output "APK for testing: $debug"
Write-Output "Unsigned APK for your release key: $unsigned"
