@echo off
title WIOM IT Helpdesk - SD Card Fix
color 0E
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - SD Card Auto-Fix
echo  ============================================
echo.
echo  [1/3]  SD Card detect kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$sd=Get-Disk|Where-Object{$_.BusType -eq 'SD'}; if($sd){Write-Host '    SD Card found:' $sd.FriendlyName $sd.Size/1GB 'GB'}else{Write-Host '    SD Card not detected — check physical card'}"
echo.
echo  [2/3]  Hardware scan kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "pnputil /scan-devices 2>$null; Write-Host '    Hardware scan complete'"
echo.
echo  [3/3]  SD Controller check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$ctrl=Get-PnpDevice|Where-Object{$_.FriendlyName -match 'SD|Memory Card|MMC'}; if($ctrl){$ctrl|ForEach-Object{Write-Host '    SD Controller:' $_.FriendlyName '|' $_.Status}}else{Write-Host '    SD Controller driver may need update'}"
echo.
echo  ============================================
echo    DONE! SD Card scan kiya.
echo.
echo    Steps try karo:
echo    1. Card nikaalo, wait 5 sec, dobara lagao
echo    2. File Explorer check karo (This PC)
echo    3. Device Manager -> Memory -> Scan
echo.
echo    IT Helpdesk: Slack pe ticket raise karo
echo  ============================================
echo.
pause
