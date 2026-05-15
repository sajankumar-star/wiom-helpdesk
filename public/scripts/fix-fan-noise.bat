@echo off
title WIOM IT Helpdesk - Fan Noise Fix
color 0A
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Fan Noise Auto-Fix
echo  ============================================
echo.
echo  [1/3]  Heavy apps band kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$safe=@('svchost','System','Idle','Registry','smss','csrss','wininit','services','lsass','winlogon','dwm','explorer'); $c=0; Get-Process|Where-Object{$_.Name -notin $safe -and $_.CPU -gt 15}|Sort-Object CPU -Descending|Select-Object -First 4|ForEach-Object{Write-Host '    Closing:' $_.Name; try{Stop-Process -Id $_.Id -Force;$c++}catch{}}; Write-Host '   '$c 'heavy apps closed'"
echo.
echo  [2/3]  CPU load check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$cpu=(Get-CimInstance -ClassName Win32_Processor).LoadPercentage; Write-Host '    CPU load:' $cpu'%'; if([int]$cpu -gt 80){Write-Host '    HIGH CPU — laptop garam hai, fan chalna normal hai'}else{Write-Host '    CPU normal hai'}"
echo.
echo  [3/3]  Power plan Balanced pe set kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "powercfg /setactive SCHEME_BALANCED; powercfg /change processor-throttle-ac 75; Write-Host '    Power plan: Balanced (fan control improved)'"
echo.
echo  ============================================
echo    DONE! Fan noise reduce karne ki koshish ki.
echo.
echo    Fan zyada isliye chalta hai kyunki:
echo    1. Heavy apps chal rahe hain (ab band kiye)
echo    2. Laptop garam hai — surface saaf karo
echo    3. Laptop neeche raise karo airflow ke liye
echo    4. Laptop bottom mein dust ho sakta hai
echo.
echo    Agar fan bahut loud hai ya grinding sound hai:
echo    Hardware issue ho sakta hai — ticket raise karo
echo    IT Helpdesk: Slack pe ticket raise karo
echo  ============================================
echo.
pause
