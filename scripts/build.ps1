param([string]$Version = '1.6.5', [switch]$SkipLauncher)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Push-Location $root
try {
    New-Item -ItemType Directory -Force dist | Out-Null
    $previousOS = $env:GOOS; $previousArch = $env:GOARCH; $previousCGO = $env:CGO_ENABLED
    try {
        $env:CGO_ENABLED = '0'
        foreach ($platform in @('linux/amd64','linux/arm64','darwin/amd64','darwin/arm64','windows/amd64','windows/arm64')) {
            $env:GOOS, $env:GOARCH = $platform.Split('/')
            $suffix = if ($env:GOOS -eq 'windows') { '.exe' } else { '' }
            go build -trimpath -ldflags "-s -w -X main.version=v$Version" -o "dist/streamwebrom-$($env:GOOS)-$($env:GOARCH)$suffix" ./cmd/streamwebrom
            if ($LASTEXITCODE) { throw "Build failed: $platform" }
        }
    } finally { $env:GOOS = $previousOS; $env:GOARCH = $previousArch; $env:CGO_ENABLED = $previousCGO }
    if (!$SkipLauncher) {
        dotnet publish windows/StreamWebRom.Launcher -c Release -o dist/windows-launcher
        if ($LASTEXITCODE) { throw 'Launcher build failed' }
        Copy-Item -LiteralPath dist/windows-launcher/StreamWebRom.exe -Destination dist/StreamWebRom-Windows-x64.exe -Force
    }
    Get-ChildItem dist -File | Where-Object Name -ne 'SHA256SUMS.txt' | Sort-Object Name | ForEach-Object {
        "{0}  {1}" -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $_.Name
    } | Set-Content -LiteralPath dist/SHA256SUMS.txt -Encoding ascii
} finally { Pop-Location }
