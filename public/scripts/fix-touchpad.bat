@echo off
title WIOM IT Helpdesk - Touchpad Fix
color 0B
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Touchpad Auto-Fix
echo  ============================================
echo.
echo  [1/3]  Touchpad enable kar rahe hain (registry)...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\PrecisionTouchpad' -Name 'Enabled' -Value 1 -ErrorAction SilentlyContinue; Write-Host '    Touchpad enabled in registry'"
echo.
echo  [2/3]  Touchpad driver reset kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$tp=Get-PnpDevice|Where-Object{$_.FriendlyName -match 'touchpad|precision|synaptics|elan' -and $_.Class -eq 'Mouse'}|Select-Object -First 1; if($tp){Disable-PnpDevice -InstanceId $tp.InstanceId -Confirm:$false -ErrorAction SilentlyContinue; Start-Sleep 2; Enable-PnpDevice -InstanceId $tp.InstanceId -Confirm:$false -ErrorAction SilentlyContinue; Write-Host '    Touchpad driver reset: '$tp.FriendlyName}else{Write-Host '    Touchpad device: checking manually'}"
echo.
echo  [3/3]  Settings open kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Start-Process 'ms-settings:devices-touchpad'; Write-Host '    Touchpad Settings opened — check ON switch'"
echo.
echo  ============================================
echo    DONE! Touchpad settings khuli hain.
echo.
echo    Settings mein Touchpad ON karo.
echo    Fn + Touchpad key bhi try karo.
echo  ============================================
echo.
pause
