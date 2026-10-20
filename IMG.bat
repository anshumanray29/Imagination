@echo off
rem Double-click to start IMG. It builds the UI, starts the server and opens your browser.
rem Close this window (or press Ctrl+C) to stop IMG.
title IMG - Imagination
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies for the first run...
  call npm install || goto :error
)
if not exist .env copy .env.example .env >nul
set OPEN_BROWSER=1
call npm start
goto :eof

:error
echo.
echo Setup failed - see the messages above.
pause
