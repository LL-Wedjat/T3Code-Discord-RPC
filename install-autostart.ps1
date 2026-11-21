param([Parameter(Mandatory = $true)][string]$Root)

$startup = [Environment]::GetFolderPath('Startup')
if (-not (Test-Path $startup)) {
  New-Item -ItemType Directory -Path $startup -Force | Out-Null
}

$shortcut = Join-Path $startup 't3code-discord-rpc.lnk'
$script = Join-Path $Root 'start-hidden.vbs'

$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($shortcut)
$link.TargetPath = 'wscript.exe'
$link.Arguments = '"' + $script + '"'
$link.WorkingDirectory = $Root
$link.Save()

Write-Host "Installed startup shortcut: $shortcut"
