@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$localOk=$false;$publicOk=$false;try{$localOk=(Invoke-RestMethod 'http://127.0.0.1:8787/api/ready' -TimeoutSec 3).ok}catch{};try{$publicOk=(Invoke-RestMethod 'https://mybills.portalsgi.dev.br/api/ready' -TimeoutSec 8).ok}catch{};$task=Get-ScheduledTaskInfo -TaskName 'MyBills - Verificador 5 minutos' -ErrorAction SilentlyContinue;Write-Host ('Servidor local: ' + $(if($localOk){'OK'}else{'FALHA'}));Write-Host ('Acesso do celular: ' + $(if($publicOk){'OK'}else{'FALHA'}));if($task){Write-Host ('Ultima verificacao: ' + $task.LastRunTime);Write-Host ('Resultado: ' + $task.LastTaskResult)}"
echo.
pause
endlocal
