[CmdletBinding()]
param (
    [Parameter(Mandatory = $true)]
    [string]$TargetFile
)

# Resolve TargetFile full path
if (-not (Test-Path -Path $TargetFile)) {
    Write-Error "Target file does not exist: $TargetFile"
    exit 1
}
$resolvedTarget = (Resolve-Path -Path $TargetFile).ProviderPath

# Find signtool
$signtool = $null
$cmd = Get-Command signtool -ErrorAction SilentlyContinue
if ($cmd) {
    $signtool = $cmd.Source
} else {
    $sdkPaths = @(
        "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe",
        "${env:ProgramFiles}\Windows Kits\10\bin\*\x64\signtool.exe",
        "${env:ProgramFiles(x86)}\Windows Kits\10\App Certification Kit\signtool.exe",
        "${env:ProgramFiles}\Windows Kits\10\App Certification Kit\signtool.exe",
        "${env:ProgramFiles(x86)}\Microsoft SDKs\Windows\*\bin\NETFX *\signtool.exe"
    )
    foreach ($pattern in $sdkPaths) {
        $found = Resolve-Path $pattern -ErrorAction SilentlyContinue | Select-Object -Last 1
        if ($found) {
            $signtool = $found.ProviderPath
            break
        }
    }
}

# Read certificate settings from environment variables
$thumbprint = $env:T3CODE_SIGN_THUMBPRINT
$pfxPath = $env:T3CODE_SIGN_PFX
$password = $env:T3CODE_SIGN_PASSWORD
$timestampUrl = $env:T3CODE_SIGN_TIMESTAMP

if (-not $thumbprint -and -not $pfxPath) {
    Write-Host "No code signing certificate configured (T3CODE_SIGN_THUMBPRINT or T3CODE_SIGN_PFX not set). Skipping signing."
    exit 0
}

if (-not $signtool -or -not (Test-Path $signtool)) {
    Write-Error "signtool.exe not found on system. Cannot sign target file."
    exit 1
}

$signArgs = @("sign", "/fd", "SHA256")

if ($thumbprint) {
    $signArgs += @("/sha1", $thumbprint)
} elseif ($pfxPath) {
    $signArgs += @("/f", $pfxPath)
    if ($password) {
        $signArgs += @("/p", $password)
    }
}

if ($timestampUrl) {
    $signArgs += @("/tr", $timestampUrl, "/td", "SHA256")
}

$signArgs += $resolvedTarget

Write-Host "Executing: $signtool $($signArgs -join ' ')"
& $signtool @signArgs

if ($LASTEXITCODE -ne 0) {
    Write-Error "signtool failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}

Write-Host "Successfully signed: $resolvedTarget"
exit 0
