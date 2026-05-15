@echo off
title WIOM IT Helpdesk - HDMI / External Display Fix
color 07
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - HDMI Display Auto-Fix
echo  ============================================
echo.
echo  [1/3]  Display detect kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$monitors=(Get-CimInstance -ClassName Win32_DesktopMonitor).Count; Write-Host '    Monitors detected:' $monitors"
echo.
echo  [2/3]  Display mode switch kar rahe hain (Extend)...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens|ForEach-Object{Write-Host '    Screen:' $_.DeviceName $_.Bounds.Width'x'$_.Bounds.Height}"
echo     Opening display settings...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Start-Process 'ms-settings:display'; Write-Host '    Display Settings opened'"
echo.
echo  [3/3]  Display driver check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$gpu=Get-CimInstance -ClassName Win32_VideoController|Select-Object -First 1; Write-Host '    GPU:' $gpu.Name '| Status:' $gpu.Status"
echo.
echo  ============================================
echo    DONE! Display settings khuli hain.
echo.
echo    Manual steps:
echo    Win + P dabao -> Duplicate ya Extend
echo    select karo.
echo.
echo    HDMI cable dono taraf check karo.
echo    IT Helpdesk: Slack pe ticket raise karo
echo  ============================================
echo.
pause
