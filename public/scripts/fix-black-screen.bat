@echo off
title WIOM IT Helpdesk - Black Screen Fix
color 07
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Black Screen Fix
echo  ============================================
echo.
echo  [1/3]  Display driver restart kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '    Trying: Win+Ctrl+Shift+B (display reset)'"
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('%{ESC}')"
echo.
echo  [2/3]  Display adapter check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$d=Get-CimInstance -ClassName Win32_VideoController|Select-Object -First 1; Write-Host '    Display adapter:' $d.Name"
echo.
echo  [3/3]  Brightness maximum set kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,100) 2>$null; Write-Host '    Brightness set to maximum'"
echo.
echo  ============================================
echo    Manual steps bhi try karo:
echo.
echo    1. Fn + F5 ya Fn + F8 key dabao
echo       (brightness increase key)
echo    2. External monitor connect karo HDMI se
echo       aur Win+P dabao
echo.
echo    IT Helpdesk: Slack pe ticket raise karo
echo  ============================================
echo.
pause
