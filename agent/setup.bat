@echo off
:: ╔══════════════════════════════════════════════════════════════╗
:: ║  WIOM IT Helpdesk — Auto-Fix Agent Setup                    ║
:: ║  Run as Administrator on the employee's Windows laptop.     ║
:: ╚══════════════════════════════════════════════════════════════╝

title WIOM IT Auto-Fix Agent Setup
color 0A
echo.
echo  ============================================
echo   WIOM IT Helpdesk - Auto-Fix Agent Setup
echo  ============================================
echo.

:: ── Check admin rights ────────────────────────────────────────
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Please run this script as Administrator!
    echo  Right-click setup.bat and choose "Run as administrator"
    pause
    exit /b 1
)

:: ── Check Node.js ─────────────────────────────────────────────
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js is not installed!
    echo.
    echo  Please install Node.js from: https://nodejs.org
    echo  Then run this setup again.
    echo.
    pause
    exit /b 1
)

echo  [OK] Node.js found:
node --version
echo.

:: ── Get laptop serial number automatically ────────────────────
echo  Detecting laptop serial number...
for /f "skip=1 delims=" %%i in ('wmic bios get serialnumber') do (
    if not defined LAPTOP_SN (
        set LAPTOP_SN=%%i
    )
)
:: Trim whitespace
set LAPTOP_SN=%LAPTOP_SN: =%
echo  Laptop SN detected: %LAPTOP_SN%
echo.

:: ── Get info from IT admin ────────────────────────────────────
set /p EMP_ID="  Enter Employee Keka ID (e.g. WIOM001): "
set /p AGENT_SECRET="  Enter Agent Secret (from IT Admin): "
set SERVER_URL=https://web-production-ef6c1.up.railway.app

echo.
echo  Configuration:
echo  ─────────────────────────────────────
echo   Server     : %SERVER_URL%
echo   Laptop SN  : %LAPTOP_SN%
echo   Employee ID: %EMP_ID%
echo  ─────────────────────────────────────
echo.

:: ── Write config.json ─────────────────────────────────────────
set AGENT_DIR=%~dp0
echo { > "%AGENT_DIR%config.json"
echo   "SERVER_URL"   : "%SERVER_URL%", >> "%AGENT_DIR%config.json"
echo   "AGENT_SECRET" : "%AGENT_SECRET%", >> "%AGENT_DIR%config.json"
echo   "LAPTOP_SN"    : "%LAPTOP_SN%", >> "%AGENT_DIR%config.json"
echo   "EMP_ID"       : "%EMP_ID%" >> "%AGENT_DIR%config.json"
echo } >> "%AGENT_DIR%config.json"
echo  [OK] config.json created.

:: ── Create Windows Scheduled Task (runs at login, stays running) ──
set TASK_NAME=WIOM_IT_Agent
set NODE_SCRIPT="%AGENT_DIR%wiom-agent.js"

:: Delete existing task if any
schtasks /delete /tn "%TASK_NAME%" /f >nul 2>&1

:: Create new task: runs node wiom-agent.js at user logon
schtasks /create /tn "%TASK_NAME%" /tr "node %NODE_SCRIPT%" /sc ONLOGON /rl HIGHEST /f >nul 2>&1

if %errorlevel% equ 0 (
    echo  [OK] Windows Task created: %TASK_NAME%
    echo       Agent will start automatically on every login.
) else (
    echo  [WARN] Could not create scheduled task.
    echo         Please add manually: Task Scheduler ^> Create Basic Task
    echo         Program: node
    echo         Arguments: %NODE_SCRIPT%
)

:: ── Start agent now ───────────────────────────────────────────
echo.
echo  Starting agent now...
start "WIOM IT Agent" /min node "%NODE_SCRIPT%"
echo  [OK] Agent started in background!

echo.
echo  ============================================
echo   Setup Complete!
echo.
echo   The WIOM IT Auto-Fix Agent is now running.
echo   Employees can click "Auto-Fix" in Slack
echo   and this laptop will fix issues automatically.
echo.
echo   To check status: Task Manager > "node"
echo  ============================================
echo.
pause
