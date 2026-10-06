$ErrorActionPreference = 'Stop'

$HostRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$RuntimeDir = Join-Path $env:LOCALAPPDATA 'MyBills\Server\Runtime'
$DataDir = Join-Path $env:LOCALAPPDATA 'MyBills\Server\Data'
$BackupRoot = if ($env:OneDrive) { Join-Path $env:OneDrive 'MyBills-Backups' } else { Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'MyBills-Backups' }
$Node = Join-Path $HostRoot 'tools\node.exe'
$Cloudflared = Join-Path $HostRoot 'tools\cloudflared.exe'
$ServerScript = Join-Path $HostRoot 'app\cloud-server.cjs'
$TunnelConfig = Join-Path $HostRoot 'config\cloudflared-mybills.yml'
$SecretFile = Join-Path $HostRoot 'config\secret.dpapi'
$TrayLauncher = Join-Path $HostRoot 'scripts\tray-hidden.vbs'
$LogPath = Join-Path $RuntimeDir 'supervisor.log'
$PublicUrl = 'https://mybills.portalsgi.dev.br'
$Port = 8787

New-Item -ItemType Directory -Path $RuntimeDir,$DataDir,$BackupRoot -Force | Out-Null

function Write-HostLog([string]$Message) {
    if ((Test-Path -LiteralPath $LogPath) -and (Get-Item -LiteralPath $LogPath).Length -gt 2MB) {
        Move-Item -LiteralPath $LogPath -Destination "$LogPath.1" -Force
    }
    Add-Content -LiteralPath $LogPath -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
}

function Read-ProtectedSecret {
    if (-not (Test-Path -LiteralPath $SecretFile -PathType Leaf)) { throw 'Segredo protegido do servidor não foi encontrado.' }
    $secure = Get-Content -LiteralPath $SecretFile -Raw | ConvertTo-SecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Test-LocalReady {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/api/ready" -TimeoutSec 2
        return $response.StatusCode -eq 200
    } catch { return $false }
}

function Test-PublicReady {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "$PublicUrl/api/ready" -TimeoutSec 7
        return $response.StatusCode -eq 200
    } catch { return $false }
}

function Get-ServerProcess {
    return Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*$ServerScript*" } |
        Select-Object -First 1
}

function Get-TunnelProcess {
    return Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*$TunnelConfig*" } |
        Select-Object -First 1
}

function Wait-LocalReady {
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if (Test-LocalReady) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Start-MyBillsServer {
    if (Test-LocalReady) { return }
    $existing = Get-ServerProcess
    if ($existing) {
        Stop-Process -Id $existing.ProcessId -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 500
    }
    if (-not (Test-Path -LiteralPath $Node -PathType Leaf)) { throw 'Runtime Node.js do MyBills não foi encontrado.' }
    $env:PORT = [string]$Port
    $env:MYBILLS_DATA_DIR = $DataDir
    $env:MYBILLS_JWT_SECRET = Read-ProtectedSecret
    $env:MYBILLS_ALLOWED_ORIGINS = ''
    Start-Process -FilePath $Node -ArgumentList @($ServerScript) -WorkingDirectory $HostRoot -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $RuntimeDir 'server.stdout.log') `
        -RedirectStandardError (Join-Path $RuntimeDir 'server.stderr.log') | Out-Null
    if (-not (Wait-LocalReady)) { throw 'Servidor local não respondeu após a inicialização.' }
    Write-HostLog 'Servidor local iniciado e armazenamento validado.'
}

function Start-MyBillsTunnel {
    if (Get-TunnelProcess) { return }
    if (-not (Test-Path -LiteralPath $Cloudflared -PathType Leaf)) { throw 'cloudflared.exe não foi encontrado.' }
    Start-Process -FilePath $Cloudflared -ArgumentList @('tunnel','--no-autoupdate','--config',('"' + $TunnelConfig + '"'),'run') `
        -WorkingDirectory $HostRoot -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $RuntimeDir 'tunnel.stdout.log') `
        -RedirectStandardError (Join-Path $RuntimeDir 'tunnel.stderr.log') | Out-Null
    Write-HostLog 'Túnel público iniciado.'
}

function Restart-MyBillsServer {
    $existing = Get-ServerProcess
    if ($existing) { Stop-Process -Id $existing.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 750
    Start-MyBillsServer
    Write-HostLog 'Servidor reiniciado automaticamente após falha.'
}

function Restart-MyBillsTunnel {
    $existing = Get-TunnelProcess
    if ($existing) { Stop-Process -Id $existing.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 750
    Start-MyBillsTunnel
    Write-HostLog 'Túnel reiniciado automaticamente após falha pública.'
}

function Start-TrayMonitor {
    $trayScript = Join-Path $HostRoot 'scripts\tray-monitor.ps1'
    $existing = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*$trayScript*" } |
        Select-Object -First 1
    if ($existing) { return }
    Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\wscript.exe') `
        -ArgumentList @('//B','//NoLogo',('"' + $TrayLauncher + '"')) -WorkingDirectory $HostRoot -WindowStyle Hidden
    Write-HostLog 'Indicador da bandeja iniciado.'
}

function Backup-EncryptedStore {
    $store = Join-Path $DataDir 'store.json'
    if (-not (Test-Path -LiteralPath $store -PathType Leaf)) { return }
    Copy-Item -LiteralPath $SecretFile -Destination (Join-Path $BackupRoot 'host-secret.dpapi') -Force
    $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
    $destination = Join-Path $BackupRoot "mybills-$stamp.store.json"
    Copy-Item -LiteralPath $store -Destination $destination
    Get-ChildItem -LiteralPath $BackupRoot -Filter 'mybills-*.store.json' -File |
        Sort-Object LastWriteTime -Descending | Select-Object -Skip 84 |
        Remove-Item -Force -ErrorAction SilentlyContinue
    Write-HostLog "Backup criptografado criado: $destination"
}

$isFirstInstance = $false
$mutex = New-Object Threading.Mutex($true, 'Local\MyBillsBackgroundSupervisor', [ref]$isFirstInstance)
if (-not $isFirstInstance) { exit 0 }

$localFailures = 0
$publicFailures = 0
$lastBackup = [datetime]::MinValue

try {
    Write-HostLog 'Supervisor silencioso iniciado.'
    while ($true) {
        try {
            if (Test-LocalReady) { $localFailures = 0 } else { $localFailures++ }
            if (-not (Get-ServerProcess) -or $localFailures -ge 2) {
                Restart-MyBillsServer
                $localFailures = 0
            }

            if (-not (Get-TunnelProcess)) {
                Start-MyBillsTunnel
                $publicFailures = 0
            } elseif (Test-LocalReady) {
                if (Test-PublicReady) { $publicFailures = 0 } else { $publicFailures++ }
                if ($publicFailures -ge 3) {
                    Restart-MyBillsTunnel
                    $publicFailures = 0
                }
            }

            if ((Test-Path -LiteralPath (Join-Path $RuntimeDir 'restart.request'))) {
                Remove-Item -LiteralPath (Join-Path $RuntimeDir 'restart.request') -Force
                Restart-MyBillsServer
                Restart-MyBillsTunnel
            }

            if (((Get-Date) - $lastBackup).TotalHours -ge 2) {
                Backup-EncryptedStore
                $lastBackup = Get-Date
            }
            Start-TrayMonitor
        } catch { Write-HostLog "ERRO DO SUPERVISOR: $($_.Exception.Message)" }
        Start-Sleep -Seconds 15
    }
} catch {
    Write-HostLog "ERRO FATAL: $($_.Exception.Message)"
    exit 1
} finally {
    if ($isFirstInstance) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
