@echo off
REM ============================================
REM   OneLife - Manage Auto-Startup
REM ============================================
REM Enable or disable OneLife auto-start at logon.
REM ============================================

setlocal
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT=%STARTUP%\OneLife.lnk"
set "SILENT=%~dp0start_silent.vbs"

if "%1"=="--disable" goto :disable
if "%1"=="/disable" goto :disable
if "%1"=="--enable" goto :enable
if "%1"=="/enable" goto :enable

:menu
cls
echo ============================================
echo   OneLife - Manage Auto-Startup
echo ============================================
echo.
if exist "%SHORTCUT%" (
    echo Status: ENABLED - OneLife will start at logon.
) else (
    echo Status: DISABLED - OneLife will NOT start at logon.
)
echo.
echo Choose an option:
echo   1. Enable auto-start
echo   2. Disable auto-start
echo   3. Open Startup folder
echo   4. Test launch now
echo   5. Exit
echo.
set /p choice="Enter choice (1-5): "

if "%choice%"=="1" goto :enable
if "%choice%"=="2" goto :disable
if "%choice%"=="3" goto :openfolder
if "%choice%"=="4" goto :testlaunch
if "%choice%"=="5" exit /b 0
goto :menu

:enable
if not exist "%SILENT%" (
    echo ERROR: start_silent.vbs not found in %~dp0
    pause
    exit /b 1
)
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT%'); $s.TargetPath = 'wscript.exe'; $s.Arguments = '\"%SILENT%\"'; $s.WorkingDirectory = '%~dp0.'; $s.Description = 'Launch OneLife dashboard in Chrome'; $s.WindowStyle = 7; $s.Save()"
if exist "%SHORTCUT%" (
    echo.
    echo Auto-start ENABLED. OneLife will launch at logon.
) else (
    echo Failed to create shortcut.
)
pause
goto :menu

:disable
if exist "%SHORTCUT%" (
    del /f /q "%SHORTCUT%" >nul 2>&1
    echo Auto-start DISABLED. OneLife will not launch at logon.
) else (
    echo Auto-start was already disabled.
)
pause
goto :menu

:openfolder
start "" "%STARTUP%"
goto :menu

:testlaunch
call "%~dp0start.bat"
goto :menu

endlocal
