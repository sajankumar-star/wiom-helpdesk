@echo off
title WIOM IT Helpdesk - Freezing / Hanging Fix
color 0C
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Freezing Auto-Fix
echo  ============================================
echo.
echo  Laptop unfreeze kar rahe hain...
echo.
echo  ============================================
echo.

echo  [1/3]  "Not Responding" apps band kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command ^
  "$safe = @('svchost','System','Idle','Registry','smss','csrss','wininit','services','lsass','winlogon','dwm','explorer'); $count=0; Get-Process | Where-Object {$_.Name -notin $safe -and $_.Responding -eq $false} | ForEach-Object { try { Stop-Process -Id $_.Id -Force; $count++ } catch {} }; Write-Host '   ' $count 'not-responding apps closed'"
echo.

echo  [2/3]  Memory free kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command ^
  "$safe = @('svchost','System','Idle','Registry','smss','csrss','wininit','services','lsass','winlogon','dwm','explorer','SearchHost'); $count=0; Get-Process | Where-Object {$_.Name -notin $safe -and $_.CPU -gt 15} | Sort-Object CPU -Descending | Select-Object -First 3 | ForEach-Object { try { Stop-Process -Id $_.Id -Force; $count++ } catch {} }; Write-Host '   ' $count 'heavy apps closed'"
echo.

echo  [3/3]  Temp files quick clean...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command ^
  "Remove-Item $env:TEMP\* -Recurse -Force -ErrorAction SilentlyContinue; Write-Host '    Temp cleared'"
echo.

echo  ============================================
echo.
echo    DONE! Laptop ab smooth hona chahiye.
echo.
echo    Agar abhi bhi hang ho raha hai:
echo    Laptop restart karo (Start -> Restart)
echo.
echo    IT Helpdesk: Slack pe ticket raise karo
echo.
echo  ============================================
echo.
pause
