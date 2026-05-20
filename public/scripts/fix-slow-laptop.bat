@echo off
title WIOM IT Helpdesk - Slow Laptop Fix
color 0A
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Slow Laptop Auto-Fix
echo  ============================================
echo.
echo  Yeh script automatically aapka laptop fix
echo  kar degi. Kuch nahi karna - bas wait karo!
echo.
echo  ============================================
echo.

echo  [1/4]  Heavy apps band kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command ^
  "$safe = @('svchost','System','Idle','Registry','smss','csrss','wininit','services','lsass','winlogon','dwm','explorer','SearchHost','ShellExperienceHost','StartMenuExperienceHost','RuntimeBroker','MsMpEng'); $count=0; Get-Process | Where-Object {$_.Name -notin $safe -and $_.CPU -gt 10} | Sort-Object CPU -Descending | Select-Object -First 5 | ForEach-Object { try { Stop-Process -Id $_.Id -Force; $count++ } catch {} }; Write-Host '    '$count 'apps closed'"
echo.

echo  [2/4]  Temp files delete kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command ^
  "Remove-Item $env:TEMP\* -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item C:\Windows\Temp\* -Recurse -Force -ErrorAction SilentlyContinue; Write-Host '    Temp files cleared'"
echo.

echo  [3/4]  Recycle Bin empty kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command ^
  "Clear-RecycleBin -Force -ErrorAction SilentlyContinue; Write-Host '    Recycle Bin cleared'"
echo.

echo  [4/4]  Startup apps check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command ^
  "$free = [math]::Round((Get-PSDrive C).Free/1GB,1); Write-Host '    C: Drive Free Space:' $free 'GB'"
echo.

echo  ============================================
echo.
echo    DONE! Aapka laptop ab fast hona chahiye.
echo.
echo  ============================================
echo.
echo    Agar abhi bhi slow hai to ghabrao mat!
echo.
echo    Step 1: Slack kholo
echo    Step 2: WIOM IT Helpdesk bot ko message karo
echo    Step 3: /ticket type karo aur Enter dabao
echo    Step 4: Form mein problem likho aur Submit karo
echo.
echo    Ya seedha message karo:
echo    "Mera laptop bahut slow hai, ticket banana hai"
echo.
echo    IT Team 30 minute mein aapko contact karegi!
echo.
echo  ============================================
echo.
pause
