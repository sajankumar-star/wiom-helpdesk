@echo off
title WIOM IT Helpdesk - Outlook Fix
color 0B
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Outlook Auto-Fix
echo  ============================================
echo.
echo  Outlook restart kar rahe hain Safe Mode mein...
echo.
echo  ============================================
echo.

echo  [1/2]  Outlook band kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command ^
  "Stop-Process -Name 'OUTLOOK' -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2; Write-Host '    Outlook closed'"
echo.

echo  [2/2]  Outlook Safe Mode mein start kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command ^
  "Start-Process -FilePath 'outlook.exe' -ArgumentList '/safe' -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2; Write-Host '    Outlook starting in safe mode...'"
echo.

echo  ============================================
echo.
echo    DONE! Outlook Safe Mode mein khul raha hai.
echo.
echo    Agar email aa rahe hain Safe Mode mein:
echo    Close karo -> normally dobara kholo
echo.
echo    Agar Safe Mode mein bhi nahi chala:
echo    IT Helpdesk: 9654244281 (9AM - 7PM)
echo.
echo  ============================================
echo.
pause
