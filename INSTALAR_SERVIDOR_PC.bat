@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0server\windows-host\install-host.ps1"
if errorlevel 1 (
  echo.
  echo Nao foi possivel instalar o MyBills Server Host.
) else (
  echo.
  echo MyBills Server Host instalado e verificado.
)
pause
endlocal
