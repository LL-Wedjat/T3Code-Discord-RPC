[CmdletBinding()]
param ()

$ErrorActionPreference = "Stop"

$rootDir = (Resolve-Path "$PSScriptRoot\..").ProviderPath
$packageJsonPath = Join-Path $rootDir "package.json"

if (-not (Test-Path $packageJsonPath)) {
    Write-Error "package.json not found at $packageJsonPath"
    exit 1
}

$packageJson = Get-Content $packageJsonPath -Raw | ConvertFrom-Json
$version = $packageJson.version
if (-not $version) {
    Write-Error "Version not found in package.json"
    exit 1
}

Write-Host "Packaging t3code-discord-rpc version: $version"

$distDir = Join-Path $rootDir "dist"
$stagingDir = Join-Path $distDir "staging"
$zipPath = Join-Path $distDir "t3code-discord-rpc-$version.zip"

if (Test-Path $stagingDir) {
    Remove-Item -Recurse -Force $stagingDir
}
if (Test-Path $zipPath) {
    Remove-Item -Force $zipPath
}

New-Item -ItemType Directory -Force -Path $stagingDir | Out-Null
New-Item -ItemType Directory -Force -Path $distDir | Out-Null

# List of release files / directories
$releaseItems = @(
    "src",
    "config.example.json",
    "README.md",
    "EXPLANATION.html",
    "DEVELOPMENT_NOTES.md",
    "start-hidden.vbs",
    "install-autostart.cmd",
    "install-autostart.ps1",
    "tray.ps1",
    "LICENSE"
)

foreach ($item in $releaseItems) {
    $sourcePath = Join-Path $rootDir $item
    if (Test-Path $sourcePath) {
        Copy-Item -Path $sourcePath -Destination $stagingDir -Recurse -Force
        Write-Host "Copied $item to staging"
    } else {
        Write-Warning "Release file or directory not found, skipping: $item"
    }
}

Write-Host "Compressing staging folder into $zipPath ..."
Compress-Archive -Path "$stagingDir\*" -DestinationPath $zipPath -Force

Write-Host "Cleaning up staging directory..."
Remove-Item -Recurse -Force $stagingDir

Write-Host "Package created successfully: $zipPath"

# Call sign-windows.ps1
$signScript = Join-Path $PSScriptRoot "sign-windows.ps1"
if (Test-Path $signScript) {
    Write-Host "Invoking sign-windows.ps1 on $zipPath ..."
    & $signScript -TargetFile $zipPath
}

Write-Host "Packaging complete."
