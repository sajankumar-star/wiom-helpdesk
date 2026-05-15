@echo off
title WIOM IT Helpdesk - USB Fix
color 0E
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - USB Port Auto-Fix
echo  ============================================
echo.
echo  [1/3]  USB controllers reset kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$usb=Get-PnpDevice|Where-Object{$_.Class -eq 'USB' -and $_.Status -ne 'OK'}; $c=0; $usb|ForEach-Object{try{Disable-PnpDevice -InstanceId $_.InstanceId -Confirm:$false -ErrorAction SilentlyContinue; Start-Sleep 1; Enable-PnpDevice -InstanceId $_.InstanceId -Confirm:$false -ErrorAction SilentlyContinue; $c++}catch{}}; Write-Host '   ' $c 'USB devices reset'"
echo.
echo  [2/3]  Hardware scan kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "pnputil /scan-devices 2>$null; Write-Host '    Hardware scan complete'"
echo.
echo  [3/3]  USB power management fix kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Get-PnpDevice|Where-Object{$_.Class -eq 'USB'}|ForEach-Object{$id=$_.InstanceId; Set-ItemProperty -Path \"HKLM:\SYSTEM\CurrentControlSet\Enum\$id\Device Parameters\" -Name 'EnhancedPowerManagementEnabled' -Value 0 -ErrorAction SilentlyContinue}; Write-Host '    USB power management optimized'"
echo.
echo  ============================================
echo    DONE! USB reset ho gaya.
echo.
echo    Device nikaalo aur dobara lagao.
echo    Doosra USB port bhi try karo.
echo    IT Helpdesk: Slack pe ticket raise karo
echo  ============================================
echo.
pause
