@echo off
chcp 65001 >nul
cd /d "%~dp0"
call npm run prepare:icon
if errorlevel 1 goto erro
call npm start
exit /b 0
:erro
echo Falha ao preparar o icone.
pause
exit /b 1
