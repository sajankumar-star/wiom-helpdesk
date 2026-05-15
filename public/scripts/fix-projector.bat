@echo off
title WIOM IT Helpdesk - Projector Fix
color 0B
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Projector Auto-Fix
echo  ============================================
echo.
echo  [1/3]  Display detect kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$monitors=(Get-CimInstance -ClassName Win32_DesktopMonitor).Count; Write-Host '    Monitors/displays detected:' $monitors; Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens|ForEach-Object{Write-Host '    Screen:' $_.DeviceName $_.Bounds.Width'x'$_.Bounds.Height}"
echo.
echo  [2/3]  Display shortcut chalate hain (Win+P)...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^{ESC}'); Start-Sleep -Milliseconds 500; Write-Host '    Tip: Win+P dabao aur Duplicate ya Extend select karo'"
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Start-Process 'ms-settings:display'; Write-Host '    Display Settings opened'"
echo.
echo  [3/3]  GPU driver check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$gpu=Get-CimInstance -ClassName Win32_VideoController|Select-Object -First 1; Write-Host '    GPU:' $gpu.Name '| Status:' $gpu.Status"
echo.
echo  ============================================
echo    DONE! Display settings check karo.
echo.
echo    IMPORTANT steps:
echo    1. Win + P dabao
echo       -> Duplicate (projector pe same dikhega)
echo       -> Extend (alag screen hogi)
echo    2. HDMI/VGA cable dono side se check karo
echo    3. Projector ON hai? Input source set hai?
echo    4. Display Settings mein "Detect" click karo
echo.
echo    IT Helpdesk: Slack pe ticket raise karo
echo  ============================================
echo.
pause
