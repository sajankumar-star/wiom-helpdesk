@echo off
title WIOM IT Helpdesk - Blue Screen / Boot Error Fix
color 0C
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Blue Screen Auto-Fix
echo  ============================================
echo.
echo  [1/3]  Recent crash logs check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$events=Get-EventLog -LogName System -EntryType Error -Newest 5 -ErrorAction SilentlyContinue; $events|ForEach-Object{Write-Host '   ' $_.TimeGenerated.ToString('dd/MM HH:mm') '-' $_.Message.Substring(0,[Math]::Min(70,$_.Message.Length))}"
echo.
echo  [2/3]  System file check kar rahe hain (SFC)...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '    Running sfc /scannow... (1-2 min lagega)'; $result=sfc /verifyonly 2>&1; if($result -match 'found') { Write-Host '    Corrupted files found — run: sfc /scannow as Admin' } else { Write-Host '    System files OK' }"
echo.
echo  [3/3]  Startup apps clean kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$safe=@('svchost','System','Idle','Registry','smss','csrss','wininit','services','lsass','winlogon','dwm'); $c=0; Get-Process|Where-Object{$_.Name -notin $safe -and $_.CPU -gt 30}|Sort-Object CPU -Descending|Select-Object -First 2|ForEach-Object{try{Stop-Process -Id $_.Id -Force;$c++}catch{}}; Write-Host '   '$c 'heavy apps closed'"
echo.
echo  ============================================
echo    DONE! Blue Screen scan complete.
echo.
echo    Agar BSOD baar baar aa raha hai:
echo    1. Note karo error code (jaise DRIVER_IRQL)
echo    2. Last installed driver/update ko uninstall karo
echo    3. Admin CMD mein: sfc /scannow
echo    4. Admin CMD mein: DISM /Online /Cleanup-Image /RestoreHealth
echo.
echo    Immediately ticket raise karo:
echo  ============================================
echo.
pause
