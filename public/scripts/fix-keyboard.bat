@echo off
title WIOM IT Helpdesk - Keyboard Fix
color 0B
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Keyboard Auto-Fix
echo  ============================================
echo.
echo  [1/3]  Keyboard driver reset kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$kb=Get-PnpDevice|Where-Object{$_.FriendlyName -match 'keyboard' -and $_.Status -eq 'Error'}; if($kb){Disable-PnpDevice -InstanceId $kb.InstanceId -Confirm:$false; Start-Sleep 2; Enable-PnpDevice -InstanceId $kb.InstanceId -Confirm:$false; Write-Host '    Keyboard driver reset'}else{Write-Host '    Keyboard driver OK'}"
echo.
echo  [2/3]  Filter Keys check kar rahe hain (common issue)...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Set-ItemProperty -Path 'HKCU:\Control Panel\Accessibility\StickyKeys' -Name 'Flags' -Value '506' -ErrorAction SilentlyContinue; Set-ItemProperty -Path 'HKCU:\Control Panel\Accessibility\Keyboard Response' -Name 'Flags' -Value '122' -ErrorAction SilentlyContinue; Write-Host '    Sticky/Filter Keys disabled'"
echo.
echo  [3/3]  On-Screen Keyboard khol rahe hain (temporary use)...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Start-Process osk.exe; Write-Host '    On-Screen Keyboard opened for temporary use'"
echo.
echo  ============================================
echo    DONE! Keyboard fix try kiya.
echo.
echo    On-Screen Keyboard se kaam chalao abhi.
echo    Agar physical keyboard abhi bhi nahi
echo    chala to ticket raise karo.
echo  ============================================
echo.
pause
