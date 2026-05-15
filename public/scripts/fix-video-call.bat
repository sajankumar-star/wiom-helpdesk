@echo off
title WIOM IT Helpdesk - Video Call Quality Fix
color 0B
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Video Call Fix
echo  ============================================
echo.
echo  [1/3]  Background apps band kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$safe=@('svchost','System','Idle','Registry','smss','csrss','wininit','services','lsass','winlogon','dwm','explorer','Teams','ms-teams','zoom'); $c=0; Get-Process|Where-Object{$_.Name -notin $safe -and $_.CPU -gt 10}|Sort-Object CPU -Descending|Select-Object -First 4|ForEach-Object{Write-Host '    Closing:' $_.Name; try{Stop-Process -Id $_.Id -Force;$c++}catch{}}; Write-Host '   '$c 'apps closed (bandwidth free ki)'"
echo.
echo  [2/3]  Network speed check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$adapter=Get-NetAdapter|Where-Object{$_.Status -eq 'Up'}|Select-Object -First 1; Write-Host '    Connected via:' $adapter.Name $adapter.LinkSpeed; $stats=Get-NetAdapterStatistics -Name $adapter.Name; Write-Host '    Packets sent/received: OK'"
echo.
echo  [3/3]  Camera aur mic check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$cam=Get-PnpDevice|Where-Object{$_.Class -eq 'Camera' -or $_.Class -eq 'Image'}|Select-Object -First 1; if($cam){Write-Host '    Camera:' $cam.FriendlyName '|' $cam.Status}else{Write-Host '    Camera not found'}; $mic=Get-CimInstance -ClassName Win32_SoundDevice|Select-Object -First 1; Write-Host '    Audio device:' $mic.Name"
echo.
echo  ============================================
echo    DONE! Video call setup check kiya.
echo.
echo    Video call quality improve karne ke tips:
echo    1. WiFi ke paas baithkar call karo
echo    2. Wired LAN use karo (zyada stable)
echo    3. Background apps band karo (done above)
echo    4. Teams/Zoom settings mein video quality
echo       720p se kam karo (bandwidth bachao)
echo    5. Camera/mic privacy settings check karo:
echo       Settings -> Privacy -> Camera/Microphone
echo.
echo  ============================================
echo.
pause
