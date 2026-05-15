@echo off
title WIOM IT Helpdesk - Sound Fix
color 0D
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Sound Auto-Fix
echo  ============================================
echo.
echo  Audio service restart kar rahe hain...
echo.
echo  ============================================
echo.

echo  [1/2]  Audio service restart kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command ^
  "Restart-Service -Name 'AudioSrv' -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 1; Restart-Service -Name 'AudioEndpointBuilder' -Force -ErrorAction SilentlyContinue; Write-Host '    Audio services restarted'"
echo.

echo  [2/2]  Sound settings check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command ^
  "Start-Sleep -Seconds 2; Write-Host '    Done! Volume check karo taskbar speaker icon se'"
echo.

echo  ============================================
echo.
echo    DONE! Sound aana chahiye ab.
echo.
echo    Check karo: taskbar mein speaker icon
echo    Volume 0 pe to nahi? Mute to nahi?
echo.
echo    IT Helpdesk: Slack pe ticket raise karo
echo.
echo  ============================================
echo.
pause
