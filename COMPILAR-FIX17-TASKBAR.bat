@echo off
chcp 65001 >nul
cd /d "%~dp0"
title HCRP Launcher FIX17 - Taskbar
echo ======================================================
echo HCRP LAUNCHER FIX17 - ICONE DA BARRA DE TAREFAS
echo ======================================================
echo.
echo [1/3] Preparando icone...
call npm run prepare:icon
if errorlevel 1 goto erro
echo.
echo [2/3] Compilando launcher...
call npm run build
if errorlevel 1 goto erro
echo.
echo [3/3] Verificando icone externo...
call npm run verify:taskbar-icon
if errorlevel 1 goto erro
echo.
echo ======================================================
echo BUILD CONCLUIDO.
echo Instale o Setup gerado em dist para testar.
echo ======================================================
pause
exit /b 0
:erro
echo.
echo Ocorreu um erro. Nao feche esta janela; copie a mensagem acima.
pause
exit /b 1
