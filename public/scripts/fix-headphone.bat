@echo off
title WIOM IT Helpdesk - Headphone Fix
color 0B
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Headphone Auto-Fix
echo  ============================================
echo.
echo  [1/3]  Audio service restart kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Restart-Service -Name 'AudioSrv' -Force -ErrorAction SilentlyContinue; Restart-Service -Name 'AudioEndpointBuilder' -Force -ErrorAction SilentlyContinue; Write-Host '    Audio services restarted'"
echo.
echo  [2/3]  Audio devices check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$devices=Get-CimInstance -ClassName Win32_SoundDevice; $devices|ForEach-Object{Write-Host '    Audio device:' $_.Name '| Status:' $_.Status}"
echo.
echo  [3/3]  Sound settings khol rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Start-Process 'ms-settings:sound'; Write-Host '    Sound Settings opened'"
echo.
echo  ============================================
echo    DONE! Sound settings khuli hain.
echo.
echo    Steps try karo:
echo    1. Headphone nikaalo aur dobara lagao
echo    2. Sound Settings mein Output device check karo
echo       "Headphones" ya "Speakers" select karo
echo    3. Volume check karo — mute toh nahi?
echo    4. Taskbar speaker icon par right-click ->
echo       Sound Settings -> Output device change karo
echo.
echo    Agar headphone detect nahi ho raha:
echo    IT Helpdesk: Slack pe ticket raise karo
echo  ============================================
echo.
pause
