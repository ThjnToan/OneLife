@echo off
REM ============================================
REM        OneLife - Personal Dashboard
REM ============================================
REM Starts the Flask server and opens Chrome
REM to the dashboard. Safe to run multiple times.
REM ============================================

setlocal
cd /d "%~dp0"

REM Check if the server is already running on port 5000
netstat -ano | findstr ":5000" | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo OneLife is already running. Opening Chrome...
    goto :open_browser
)

REM Check Python is available
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Python is not installed or not in PATH.
    echo Please install Python 3.8+ from https://www.python.org/
    pause
    exit /b 1
)

REM Check dependencies are installed
python -c "import flask, flask_sqlalchemy, flask_migrate, werkzeug" >nul 2>&1
if %errorlevel% neq 0 (
    echo Installing required Python packages...
    python -m pip install -r requirements.txt
    if %errorlevel% neq 0 (
        echo ERROR: Failed to install dependencies.
        pause
        exit /b 1
    )
)

REM Start the server in a separate hidden window
echo Starting OneLife server...
start /min "OneLife Server" pythonw wsgi.py

REM Wait for the server to come up (poll up to 15s)
echo Waiting for server to start...
set /a count=0
:wait_loop
timeout /t 1 /nobreak >nul
set /a count+=1
netstat -ano | findstr ":5000" | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 goto :server_ready
if %count% lss 15 goto :wait_loop
echo WARNING: Server did not respond within 15 seconds.
echo Check the log for errors. Opening browser anyway...

:server_ready
echo Server is up!

:open_browser
REM Try to open in Chrome first, fall back to default browser
set "CHROME_PATH="
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe"
if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "CHROME_PATH=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "CHROME_PATH=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"

if defined CHROME_PATH (
    echo Opening Chrome...
    start "" "%CHROME_PATH%" --new-window --app=http://localhost:5000
) else (
    echo Chrome not found. Opening default browser...
    start "" http://localhost:5000
)

endlocal
exit
