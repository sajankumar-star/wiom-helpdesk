@echo off
title WIOM IT Helpdesk - Caps Lock / Stuck Key Fix
color 0E
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Caps Lock Key Fix
echo  ============================================
echo.
echo  [1/3]  Sticky Keys aur Filter Keys disable kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Set-ItemProperty -Path 'HKCU:\Control Panel\Accessibility\StickyKeys' -Name 'Flags' -Value '506' -ErrorAction SilentlyContinue; Set-ItemProperty -Path 'HKCU:\Control Panel\Accessibility\Keyboard Response' -Name 'Flags' -Value '122' -ErrorAction SilentlyContinue; Set-ItemProperty -Path 'HKCU:\Control Panel\Accessibility\ToggleKeys' -Name 'Flags' -Value '58' -ErrorAction SilentlyContinue; Write-Host '    Sticky Keys, Filter Keys, Toggle Keys disabled'"
echo.
echo  [2/3]  Keyboard driver reset kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$kbd=Get-PnpDevice|Where-Object{$_.Class -eq 'Keyboard' -and $_.Status -eq 'OK'}|Select-Object -First 1; if($kbd){Disable-PnpDevice -InstanceId $kbd.InstanceId -Confirm:$false -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2; Enable-PnpDevice -InstanceId $kbd.InstanceId -Confirm:$false -ErrorAction SilentlyContinue; Write-Host '    Keyboard driver reset:' $kbd.FriendlyName}else{Write-Host '    Keyboard driver reset skipped'}"
echo.
echo  [3/3]  Keyboard settings open kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Start-Process 'ms-settings:easeofaccess-keyboard'; Write-Host '    Keyboard Accessibility settings opened'"
echo.
echo  ============================================
echo    DONE! Caps Lock fix kiya.
echo.
echo    Abhi Caps Lock key try karo.
echo.
echo    Agar ek specific key stuck hai:
echo    1. Key ke neeche compressed air se dust hatao
echo    2. Gently key ko uthao aur press karo
echo    3. On-Screen Keyboard use karo temporarily:
echo       Start -> On-Screen Keyboard
echo.
echo    Agar keyboard physically damaged hai:
echo    IT Helpdesk: Slack pe ticket raise karo
echo  ============================================
echo.
pause
