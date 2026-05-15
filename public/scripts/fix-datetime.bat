@echo off
title WIOM IT Helpdesk - Date Time Fix
color 0E
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Date/Time Auto-Fix
echo  ============================================
echo.
echo  Date aur Time sync kar rahe hain...
echo.
echo  ============================================
echo.

echo  [1/2]  Windows Time service restart...
net stop w32time >nul 2>&1
net start w32time >nul 2>&1
echo     Time service restarted

echo.
echo  [2/2]  Internet se time sync kar rahe hain...
w32tm /resync /force >nul 2>&1
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command ^
  "$t = Get-Date -Format 'dd MMM yyyy, hh:mm tt'; Write-Host '    Current time:' $t '(IST)'"
echo.

echo  ============================================
echo.
echo    DONE! Date/Time sync ho gaya.
echo.
echo    Taskbar mein clock check karo.
echo    Agar ghalat hai: ticket bana do
echo.
echo.
echo  ============================================
echo.
pause
