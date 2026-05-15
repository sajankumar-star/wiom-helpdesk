@echo off
title WIOM IT Helpdesk - Screen Resolution Fix
color 07
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Resolution Auto-Fix
echo  ============================================
echo.
echo  [1/3]  Current resolution check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Windows.Forms; $screen=[System.Windows.Forms.Screen]::PrimaryScreen; Write-Host '    Current resolution:' $screen.Bounds.Width 'x' $screen.Bounds.Height; Write-Host '    Recommended: 1920x1080 (Full HD)'"
echo.
echo  [2/3]  Display Settings khol rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Start-Process 'ms-settings:display'; Write-Host '    Display Settings opened'"
echo.
echo  [3/3]  GPU adapter info check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$gpu=Get-CimInstance -ClassName Win32_VideoController|Select-Object -First 1; Write-Host '    GPU:' $gpu.Name; Write-Host '    Current resolution:' $gpu.CurrentHorizontalResolution 'x' $gpu.CurrentVerticalResolution"
echo.
echo  ============================================
echo    DONE! Display Settings khuli hain.
echo.
echo    Settings mein:
echo    Display Resolution -> "Recommended" select karo
echo    (Usually 1920x1080 ya laptop ka native res)
echo.
echo    Agar "Recommended" option nahi dikh raha:
echo    GPU driver update karna padega
echo  ============================================
echo.
pause
