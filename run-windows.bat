@echo off
rem AI Video Studio on Windows — no native shell, no installer.
rem
rem The pipeline is portable Node; only the macOS .app wrapper was ever platform-locked. This
rem starts the same server and opens it in the default browser, which is every feature except
rem the native window frame.
rem
rem Needs, on PATH or in vendor\:  node 22+, ffmpeg, ffprobe.  Optional: whisper-cli, Chrome.

setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [X] Node.js not found. Install Node 22 from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo [*] Installing dependencies (first run)...
  call npm install --omit=dev || (echo [X] npm install failed & pause & exit /b 1)
)

echo [*] Starting AI Video Studio...
start "" /b node src\server.js

rem The server prints AVS_READY with its port; give it a moment, then open the browser.
timeout /t 6 /nobreak >nul
for /f "usebackq tokens=*" %%u in (`type data\server.url 2^>nul`) do set AVS_URL=%%u
if "%AVS_URL%"=="" set AVS_URL=http://127.0.0.1:8123
echo [*] Opening %AVS_URL%
start "" "%AVS_URL%"

echo.
echo Closing this window stops the server.
pause >nul
