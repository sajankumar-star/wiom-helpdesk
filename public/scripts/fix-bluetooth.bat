@echo off
title WIOM IT Helpdesk - Bluetooth Fix
color 0B
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Bluetooth Auto-Fix
echo  ============================================
echo.
echo  [1/3]  Bluetooth service restart kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Restart-Service -Name 'bthserv' -Force -ErrorAction SilentlyContinue; Write-Host '    Bluetooth service restarted'"
echo.
echo  [2/3]  Bluetooth adapter disable/enable kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$bt=Get-PnpDevice|Where-Object{$_.Class -eq 'Bluetooth' -and $_.FriendlyName -match 'Radio|Adapter'}|Select-Object -First 1; if($bt){Disable-PnpDevice -InstanceId $bt.InstanceId -Confirm:$false -ErrorAction SilentlyContinue; Start-Sleep 3; Enable-PnpDevice -InstanceId $bt.InstanceId -Confirm:$false -ErrorAction SilentlyContinue; Write-Host '    Bluetooth adapter reset:' $bt.FriendlyName}else{Write-Host '    Bluetooth adapter not found — check Device Manager'}"
echo.
echo  [3/3]  Bluetooth Settings khol rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Start-Process 'ms-settings:bluetooth'; Write-Host '    Bluetooth Settings opened'"
echo.
echo  ============================================
echo    DONE! Bluetooth reset ho gaya.
echo.
echo    Settings mein Bluetooth toggle OFF->ON karo
echo    Phir apna device pair karo (Remove -> Add)
echo  ============================================
echo.
pause
