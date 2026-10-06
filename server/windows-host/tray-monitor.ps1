$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()

$HostRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$RuntimeDir = Join-Path $env:LOCALAPPDATA 'MyBills\Server\Runtime'
$BackupRoot = if ($env:OneDrive) { Join-Path $env:OneDrive 'MyBills-Backups' } else { Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'MyBills-Backups' }
$LogoPath = Join-Path $HostRoot 'assets\mybills-icon.png'
$PublicUrl = 'https://mybills.portalsgi.dev.br'
$Settings = Get-Content -LiteralPath (Join-Path $HostRoot 'config\host-settings.json') -Raw | ConvertFrom-Json

$isFirstInstance = $false
$mutex = New-Object Threading.Mutex($true, 'Local\MyBillsServerTrayMonitor', [ref]$isFirstInstance)
if (-not $isFirstInstance) { exit 0 }

function Test-Endpoint([string]$Url) {
    try { return (Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 6).StatusCode -eq 200 }
    catch { return $false }
}

$source = [Drawing.Image]::FromFile($LogoPath)
$bitmap = New-Object Drawing.Bitmap(32,32)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$graphics.DrawImage($source,0,0,32,32)
$graphics.Dispose(); $source.Dispose()
$brandIcon = [Drawing.Icon]::FromHandle($bitmap.GetHicon()).Clone()
$bitmap.Dispose()
$errorIcon = [Drawing.SystemIcons]::Error

$notify = New-Object Windows.Forms.NotifyIcon
$notify.Icon = $errorIcon
$notify.Text = 'MyBills: verificando servidor...'
$notify.Visible = $true
$menu = New-Object Windows.Forms.ContextMenuStrip
$status = $menu.Items.Add('Verificando servidor...'); $status.Enabled = $false
$menu.Items.Add((New-Object Windows.Forms.ToolStripSeparator)) | Out-Null
$openApp = $menu.Items.Add('Abrir MyBills')
$checkNow = $menu.Items.Add('Verificar agora')
$restart = $menu.Items.Add('Reiniciar servidor e conexão')
$openBackups = $menu.Items.Add('Abrir pasta de backups')
$openLogs = $menu.Items.Add('Abrir logs')
$notify.ContextMenuStrip = $menu

$openApp.Add_Click({ if (Test-Path -LiteralPath $Settings.desktopApp) { Start-Process -FilePath $Settings.desktopApp } })
$notify.Add_DoubleClick({ if (Test-Path -LiteralPath $Settings.desktopApp) { Start-Process -FilePath $Settings.desktopApp } })
$restart.Add_Click({ New-Item -ItemType File -Path (Join-Path $RuntimeDir 'restart.request') -Force | Out-Null })
$openBackups.Add_Click({ New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null; Start-Process explorer.exe -ArgumentList ('"' + $BackupRoot + '"') })
$openLogs.Add_Click({ Start-Process explorer.exe -ArgumentList ('"' + $RuntimeDir + '"') })

$script:checking = $false
function Update-Status {
    if ($script:checking) { return }
    $script:checking = $true
    try {
        $localOk = Test-Endpoint 'http://127.0.0.1:8787/api/ready'
        $publicOk = Test-Endpoint "$PublicUrl/api/ready"
        if ($localOk -and $publicOk) {
            $notify.Icon = $brandIcon
            $notify.Text = 'MyBills online - servidor e celular conectados'
            $status.Text = 'Online - local e internet funcionando'
            $status.ForeColor = [Drawing.Color]::FromArgb(7,136,91)
        } elseif ($localOk) {
            $notify.Icon = $errorIcon
            $notify.Text = 'MyBills local ativo, conexão externa indisponível'
            $status.Text = 'Atenção - servidor local ativo, internet indisponível'
            $status.ForeColor = [Drawing.Color]::FromArgb(217,92,74)
        } else {
            $notify.Icon = $errorIcon
            $notify.Text = 'MyBills offline - recuperação automática em andamento'
            $status.Text = 'Offline - recuperação automática em andamento'
            $status.ForeColor = [Drawing.Color]::FromArgb(217,92,74)
        }
    } finally { $script:checking = $false }
}

$checkNow.Add_Click({ Update-Status })
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 15000
$timer.Add_Tick({ Update-Status })
$timer.Start(); Update-Status
try { [Windows.Forms.Application]::Run() }
finally {
    $timer.Dispose(); $notify.Visible = $false; $notify.Dispose(); $brandIcon.Dispose()
    $mutex.ReleaseMutex(); $mutex.Dispose()
}
