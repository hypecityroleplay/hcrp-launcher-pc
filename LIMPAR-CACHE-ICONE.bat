@echo off
setlocal

echo.
echo ==========================================
echo  HCRP - LIMPEZA TOTAL DO CACHE DE ICONES
echo ==========================================
echo.
echo O HCRP Launcher e o Explorer serao fechados.
echo Depois o Explorer sera iniciado novamente.
echo.
pause

taskkill /F /IM "HYPE CITY ROLEPLAY.exe" >nul 2>&1
taskkill /F /IM "HCRP-Launcher.exe" >nul 2>&1
taskkill /F /IM explorer.exe >nul 2>&1

del /A /F /Q "%LOCALAPPDATA%\IconCache.db" >nul 2>&1
del /A /F /Q "%LOCALAPPDATA%\Microsoft\Windows\Explorer\iconcache*" >nul 2>&1
del /A /F /Q "%LOCALAPPDATA%\Microsoft\Windows\Explorer\thumbcache*" >nul 2>&1

ie4uinit.exe -ClearIconCache >nul 2>&1
start explorer.exe

timeout /t 2 /nobreak >nul

echo.
echo Cache limpo.
echo Desafixe o HCRP antigo da barra de tarefas se ele ainda estiver fixado.
echo Instale a nova build e fixe novamente o novo atalho.
echo.
pause
endlocal
