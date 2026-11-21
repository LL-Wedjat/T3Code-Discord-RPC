Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$bridgeProcess = $null

$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip

$itemSettings = $contextMenu.Items.Add("Open settings")
$itemSettings.add_Click({
    Start-Process node -ArgumentList 'src/index.js --settings' -WorkingDirectory $PSScriptRoot
})

$itemStart = $contextMenu.Items.Add("Start bridge")
$itemStart.add_Click({
    if ($script:bridgeProcess -eq $null -or $script:bridgeProcess.HasExited) {
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = "node"
        $psi.Arguments = "src/index.js"
        $psi.WorkingDirectory = $PSScriptRoot
        $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
        $psi.CreateNoWindow = $true
        $psi.UseShellExecute = $false
        $script:bridgeProcess = [System.Diagnostics.Process]::Start($psi)
    }
})

$itemStop = $contextMenu.Items.Add("Stop bridge")
$itemStop.add_Click({
    if ($script:bridgeProcess -ne $null -and -not $script:bridgeProcess.HasExited) {
        Stop-Process -Id $script:bridgeProcess.Id -Force -ErrorAction SilentlyContinue
        $script:bridgeProcess = $null
    }
})

$itemExit = $contextMenu.Items.Add("Exit")
$itemExit.add_Click({
    if ($script:bridgeProcess -ne $null -and -not $script:bridgeProcess.HasExited) {
        Stop-Process -Id $script:bridgeProcess.Id -Force -ErrorAction SilentlyContinue
        $script:bridgeProcess = $null
    }
    $notifyIcon.Visible = $false
    $notifyIcon.Dispose()
    [System.Windows.Forms.Application]::Exit()
})

$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
$notifyIcon.Text = "T3 Code Discord RPC"
$notifyIcon.ContextMenuStrip = $contextMenu
$notifyIcon.Visible = $true

$appContext = New-Object System.Windows.Forms.ApplicationContext
[System.Windows.Forms.Application]::Run($appContext)
