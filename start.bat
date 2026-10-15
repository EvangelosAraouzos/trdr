@echo off
rem Start trdr on Windows: double-click this file.
setlocal
cd /d "%~dp0"
title trdr

if not exist ".venv\Scripts\python.exe" (
  where python >nul 2>nul
  if errorlevel 1 (
    echo Python 3.11 or newer is needed. Install it from https://www.python.org/downloads/
    echo and tick "Add python.exe to PATH" during setup, then run this file again.
    pause
    exit /b 1
  )
  echo Creating the Python environment...
  python -m venv .venv
  if errorlevel 1 goto failed
)

".venv\Scripts\python.exe" scripts\launch.py %*
if errorlevel 1 goto failed
exit /b 0

:failed
echo.
echo trdr could not start. Read the messages above for the reason.
pause
exit /b 1
