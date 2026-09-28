@echo off
set "LOG=%TEMP%\HCRPLauncherUpdater\HCRP-helper.log"
if exist "%LOG%" (
  notepad "%LOG%"
) else (
  echo Log do helper ainda nao existe: %LOG%
  pause
)
