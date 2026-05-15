@echo off
title WIOM IT Helpdesk - Microphone Fix
color 0D
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Microphone Auto-Fix
echo  ============================================
echo.
echo  [1/3]  Microphone privacy permission ON kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Set-ItemProperty -Path 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone' -Name 'Value' -Value 'Allow' -ErrorAction SilentlyContinue; Write-Host '    Microphone privacy: Allowed'"
echo.
echo  [2/3]  Default microphone set kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$mics=Get-CimInstance -ClassName Win32_SoundDevice|Where-Object{$_.StatusInfo -eq 3}; Write-Host '    Available microphones:'; $mics|ForEach-Object{Write-Host '   -' $_.Name}"
echo.
echo  [3/3]  Sound Settings khol rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Start-Process 'ms-settings:sound'; Write-Host '    Sound Settings opened'"
echo.
echo  ============================================
echo    DONE! Mic settings check karo.
echo.
echo    Sound Settings mein:
echo    Input section mein apna mic select karo
echo    Test button dabao — bold hona chahiye
echo.
echo    Teams mein: Settings -> Devices -> Mic
echo    IT Helpdesk: Slack pe ticket raise karo
echo  ============================================
echo.
pause
