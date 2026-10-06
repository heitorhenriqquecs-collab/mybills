$ErrorActionPreference = 'Stop'
$HostRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$RuntimeDir = Join-Path $env:LOCALAPPDATA 'MyBills\Server\Runtime'
$SupervisorScript = Join-Path $HostRoot 'scripts\start-supervisor.ps1'
$Launcher = Join-Path $HostRoot 'scripts\supervisor-hidden.vbs'
$LogPath = Join-Path $RuntimeDir 'watchdog.log'
$TunnelConfig = Join-Path $HostRoot 'config\cloudflared-mybills.yml'
New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null

function Write-WatchdogLog([string]$Message) {
    Add-Content -LiteralPath $LogPath -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
}
function Get-Supervisor {
    Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*$SupervisorScript*" } | Select-Object -First 1
}
function Test-Ready([string]$Url) {
    try { return (Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 6).StatusCode -eq 200 }
    catch { return $false }
}
function Test-Components {
    if (-not (Test-Ready 'http://127.0.0.1:8787/api/ready')) { return $false }
    if (-not (Test-Ready 'https://mybills.portalsgi.dev.br/api/ready')) { return $false }
    $tunnel = Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*$TunnelConfig*" } | Select-Object -First 1
    return $null -ne $tunnel
}
function Start-Supervisor {
    Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\wscript.exe') `
        -ArgumentList @('//B','//NoLogo',('"' + $Launcher + '"')) -WorkingDirectory $HostRoot -WindowStyle Hidden
    Write-WatchdogLog 'Supervisor iniciado pelo verificador independente.'
}

$isFirstInstance = $false
$mutex = New-Object Threading.Mutex($true, 'Local\MyBillsFiveMinuteWatchdog', [ref]$isFirstInstance)
if (-not $isFirstInstance) { exit 0 }
try {
    $supervisor = Get-Supervisor
    if (-not $supervisor) { Start-Supervisor; exit 0 }
    if (Test-Components) { Write-WatchdogLog 'Verificação concluída: componentes saudáveis.'; exit 0 }
    Start-Sleep -Seconds 20
    if (Test-Components) { Write-WatchdogLog 'Oscilação temporária encerrada sem reinício.'; exit 0 }
    $supervisor = Get-Supervisor
    if ($supervisor) {
        Stop-Process -Id $supervisor.ProcessId -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
        Write-WatchdogLog 'Supervisor sem recuperação detectado e reiniciado.'
    }
    Start-Supervisor
} catch {
    Write-WatchdogLog "ERRO: $($_.Exception.Message)"
    exit 1
} finally {
    if ($isFirstInstance) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
