@echo off
title WIOM IT Helpdesk - Sudden Shutdown Fix
color 0C
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Shutdown Issue Fix
echo  ============================================
echo.
echo  [1/3]  Power settings fix kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "powercfg /change standby-timeout-ac 0; powercfg /change hibernate-timeout-ac 0; powercfg /change monitor-timeout-ac 15; powercfg /setactive SCHEME_BALANCED; Write-Host '    Power plan: Balanced, Sleep: Disabled'"
echo.
echo  [2/3]  Overheating check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$cpu=(Get-CimInstance -ClassName Win32_Processor).LoadPercentage; Write-Host '    CPU load:' $cpu'%'"; powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$safe=@('svchost','System','Idle','Registry','smss','csrss','wininit','services','lsass','winlogon','dwm','explorer'); $c=0; Get-Process|Where-Object{$_.Name -notin $safe -and $_.CPU -gt 20}|Sort-Object CPU -Descending|Select-Object -First 3|ForEach-Object{try{Stop-Process -Id $_.Id -Force;$c++}catch{}}; Write-Host '   '$c 'heavy apps closed'"
echo.
echo  [3/3]  Event log check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$events=Get-EventLog -LogName System -EntryType Error -Newest 3 -ErrorAction SilentlyContinue; $events|ForEach-Object{Write-Host '   ' $_.TimeGenerated.ToString('dd/MM HH:mm') '-' $_.Message.Substring(0,[Math]::Min(60,$_.Message.Length))}"
echo.
echo  ============================================
echo    DONE! Power settings fix ho gayi.
echo.
echo    Agar baar baar shutdown ho raha hai:
echo    Battery/thermal issue ho sakta hai
echo    Ticket raise karo: ticket bana do
echo    IT Helpdesk: Slack pe ticket raise karo
echo  ============================================
echo.
pause
