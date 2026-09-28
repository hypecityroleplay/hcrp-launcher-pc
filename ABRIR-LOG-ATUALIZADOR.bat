@echo off
set "LOG=%TEMP%\HCRPLauncherUpdater\HCRP-updater.log"
if not exist "%LOG%" (
  echo Log ainda nao foi criado:
  echo %LOG%
  echo.
  pause
  exit /b 1
)
notepad "%LOG%"
