@echo off
title WIOM IT Helpdesk - Overheating Fix
color 0C
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Overheating Auto-Fix
echo  ============================================
echo.
echo  [1/3]  Heavy apps band kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$safe=@('svchost','System','Idle','Registry','smss','csrss','wininit','services','lsass','winlogon','dwm','explorer','MsMpEng'); $c=0; Get-Process|Where-Object{$_.Name -notin $safe -and $_.CPU -gt 10}|Sort-Object CPU -Descending|Select-Object -First 5|ForEach-Object{try{Stop-Process -Id $_.Id -Force;$c++}catch{}}; Write-Host '   ' $c 'heavy apps closed'"
echo.
echo  [2/3]  Power plan Balanced set kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "powercfg /setactive SCHEME_BALANCED 2>$null; Write-Host '    Power plan set to Balanced'"
echo.
echo  [3/3]  CPU temperature check...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$cpu=(Get-CimInstance -ClassName Win32_Processor).LoadPercentage; Write-Host '    Current CPU load:' $cpu'%'"
echo.
echo  ============================================
echo    DONE! Laptop ab thanda hona chahiye.
echo.
echo    Important: Laptop hard flat surface par
echo    rakho — bed/sofa par nahi!
echo    IT Helpdesk: Slack pe ticket raise karo
echo  ============================================
echo.
pause
