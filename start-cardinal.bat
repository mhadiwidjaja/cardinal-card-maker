@echo off
rem Double-click to start the development version of Cardinal. Close this window to stop it.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies, first run only...
  call npm install || goto :error
)
rem --open launches the default browser once the server is ready.
call npm run dev -- --open
goto :eof

:error
echo.
echo Something went wrong. See the messages above.
pause
