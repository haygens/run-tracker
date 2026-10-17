@echo off
rem Run Tracker launcher: double-click to start the server and open the app.
rem Testing hooks (normally unset): PORT, ENV_FILE, NO_BROWSER=1 - see README "For testing".
setlocal
title Run Tracker
rem Always work from this file's own folder, wherever it was started from
cd /d "%~dp0"

if not defined PORT set "PORT=3000"
set "URL=http://localhost:%PORT%"
set "HEALTH=http://127.0.0.1:%PORT%/api/health"

rem Helper mode, started below: wait for the server, then open the browser
if "%~1"=="--open-when-ready" goto open_when_ready

where node >nul 2>nul || goto no_node

set "ENV_CHECK=.env"
if defined ENV_FILE set "ENV_CHECK=%ENV_FILE%"
if not exist "%ENV_CHECK%" goto no_env

rem Already running? Then just open the browser.
call :is_up && goto already_running

if exist "node_modules\" goto start_server
echo Installing dependencies (first run only)...
call npm install || goto npm_failed

:start_server
echo.
echo Starting Run Tracker on %URL%
echo The browser opens as soon as the server is ready.
echo.
echo Close this window to stop Run Tracker.
echo.
start "" /b cmd /c ""%~f0" --open-when-ready"
node server.js
rem node only gets here if the server stopped (an error, or Ctrl+C)
echo.
echo Run Tracker has stopped. If there is an error above, fix it and double-click start.bat again.
echo.
pause
exit /b 1

:open_when_ready
rem Check once a second, for up to 30 seconds
for /l %%i in (1,1,30) do (
  call :is_up && goto open_browser
  ping -n 2 127.0.0.1 >nul
)
exit /b 0

:open_browser
if defined NO_BROWSER (
  echo [NO_BROWSER is set: would open %URL%]
  exit /b 0
)
start "" "%URL%"
exit /b 0

:already_running
echo Run Tracker is already running. Opening %URL%
call :open_browser
rem Leave the message up for a moment, then close this window
ping -n 4 127.0.0.1 >nul
exit /b 0

:is_up
rem Succeeds only if Run Tracker answers its health check
curl.exe -s -f --max-time 2 -o nul "%HEALTH%" >nul 2>nul
exit /b %errorlevel%

:no_node
echo.
echo Run Tracker can't start: Node.js is not installed, or not on PATH.
echo.
echo Install it in PowerShell with:   winget install OpenJS.NodeJS.LTS
echo Then double-click start.bat again. See README.md, "Setup on Windows".
echo.
pause
exit /b 1

:no_env
echo.
echo Run Tracker can't start: no .env file with your password was found here:
for %%F in ("%ENV_CHECK%") do echo   %%~fF
echo.
echo Create it with the PowerShell commands in README.md, setup step 4.
echo.
pause
exit /b 1

:npm_failed
echo.
echo Run Tracker can't start: "npm install" failed. Check your internet connection
echo and the messages above, then double-click start.bat again.
echo.
pause
exit /b 1
