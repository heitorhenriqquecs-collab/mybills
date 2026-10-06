$ErrorActionPreference = 'Stop'

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$LegacyInstallRoot = Join-Path $env:LOCALAPPDATA 'MyBills\ServerHost'
$InstallRoot = if (Test-Path -LiteralPath 'D:\') { 'D:\MyBills-Server-Host' } else { $LegacyInstallRoot }
$ScriptsDir = Join-Path $InstallRoot 'scripts'
$ToolsDir = Join-Path $InstallRoot 'tools'
$AppDir = Join-Path $InstallRoot 'app'
$AssetsDir = Join-Path $InstallRoot 'assets'
$ConfigDir = Join-Path $InstallRoot 'config'
$RuntimeDir = Join-Path $env:LOCALAPPDATA 'MyBills\Server\Runtime'
$SecretFile = Join-Path $ConfigDir 'secret.dpapi'
$TunnelId = 'f5f2e195-d1e1-430d-a3ea-3425d3a6607e'
$TunnelCredentials = Join-Path $env:USERPROFILE ".cloudflared\$TunnelId.json"
$NodeSource = @((Join-Path $ProjectRoot 'node_modules\node\bin\node.exe'),(Join-Path $PSScriptRoot 'tools\node.exe')) |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
$CloudflaredSource = @('D:\mangueperfect\MVP\tools\cloudflare\cloudflared.exe',(Join-Path $PSScriptRoot 'tools\cloudflared.exe')) |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
$DesktopApp = Join-Path $ProjectRoot 'out\mybills-win32-x64\mybills.exe'

foreach ($directory in @($InstallRoot,$ScriptsDir,$ToolsDir,$AppDir,$AssetsDir,$ConfigDir,$RuntimeDir)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
}
if ($InstallRoot -ne $LegacyInstallRoot) {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*$LegacyInstallRoot*" -and $_.ProcessId -ne $PID } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 750
}
if (-not $NodeSource) { throw 'Node.js não foi encontrado no projeto nem no pacote do servidor.' }
if (-not $CloudflaredSource) { throw 'cloudflared não foi encontrado no MangueBeat nem no pacote do servidor.' }
if (-not (Test-Path -LiteralPath $TunnelCredentials -PathType Leaf)) { throw "Credencial do túnel não encontrada em $TunnelCredentials" }

$installedNode = Join-Path $ToolsDir 'node.exe'
$installedCloudflared = Join-Path $ToolsDir 'cloudflared.exe'
if (-not (Test-Path -LiteralPath $installedNode -PathType Leaf)) { Copy-Item -LiteralPath $NodeSource -Destination $installedNode }
if (-not (Test-Path -LiteralPath $installedCloudflared -PathType Leaf)) { Copy-Item -LiteralPath $CloudflaredSource -Destination $installedCloudflared }
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'server\cloud-server.cjs') -Destination (Join-Path $AppDir 'cloud-server.cjs') -Force
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'assets\mybills-icon.png') -Destination (Join-Path $AssetsDir 'mybills-icon.png') -Force
foreach ($file in @('start-supervisor.ps1','watchdog.ps1','tray-monitor.ps1','supervisor-hidden.vbs','watchdog-hidden.vbs','tray-hidden.vbs')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $ScriptsDir $file) -Force
}

if (-not (Test-Path -LiteralPath $SecretFile -PathType Leaf)) {
    $legacySecret = Join-Path $LegacyInstallRoot 'config\secret.dpapi'
    if ((Test-Path -LiteralPath $legacySecret -PathType Leaf) -and $legacySecret -ne $SecretFile) {
        Copy-Item -LiteralPath $legacySecret -Destination $SecretFile
    } else {
        $bytes = New-Object byte[] 48
        $random = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $random.GetBytes($bytes) } finally { $random.Dispose() }
        $plainSecret = [Convert]::ToBase64String($bytes)
        $protected = ConvertFrom-SecureString (ConvertTo-SecureString $plainSecret -AsPlainText -Force)
        [IO.File]::WriteAllText($SecretFile,$protected)
    }
}

$tunnelConfig = @"
tunnel: $TunnelId
credentials-file: $TunnelCredentials
protocol: http2

ingress:
  - hostname: mybills.portalsgi.dev.br
    service: http://127.0.0.1:8787
  - service: http_status:404
"@
[IO.File]::WriteAllText((Join-Path $ConfigDir 'cloudflared-mybills.yml'),$tunnelConfig)
[IO.File]::WriteAllText((Join-Path $ConfigDir 'host-settings.json'),(@{desktopApp=$DesktopApp;publicUrl='https://mybills.portalsgi.dev.br'} | ConvertTo-Json))

$startup = [Environment]::GetFolderPath('Startup')
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Join-Path $startup 'MyBills Servidor.lnk'))
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
$shortcut.Arguments = '//B //NoLogo "' + (Join-Path $ScriptsDir 'supervisor-hidden.vbs') + '"'
$shortcut.WorkingDirectory = $InstallRoot
$shortcut.Description = 'Mantém o servidor MyBills online'
$shortcut.Save()

$taskName = 'MyBills - Verificador 5 minutos'
$action = New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32\wscript.exe') `
    -Argument ('//B //NoLogo "' + (Join-Path $ScriptsDir 'watchdog-hidden.vbs') + '"')
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name)
$repeatTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -Hidden -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($logonTrigger,$repeatTrigger) `
    -Settings $settings -Principal $principal -Description 'Verifica e recupera o servidor, o túnel e o indicador do MyBills.' -Force | Out-Null

Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\wscript.exe') `
    -ArgumentList @('//B','//NoLogo',('"' + (Join-Path $ScriptsDir 'supervisor-hidden.vbs') + '"')) `
    -WorkingDirectory $InstallRoot -WindowStyle Hidden

$localReady = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try {
        $localReady = (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8787/api/ready' -TimeoutSec 2).StatusCode -eq 200
    } catch { $localReady = $false }
    if ($localReady) { break }
    Start-Sleep -Milliseconds 500
}
if (-not $localReady) { throw "Instalação concluída, mas o servidor local não respondeu. Consulte $RuntimeDir" }

Write-Output "MyBills Server Host instalado em $InstallRoot"
Write-Output 'Servidor local: OK'
Write-Output 'Endereço do celular: https://mybills.portalsgi.dev.br'
