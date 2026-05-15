@echo off
title WIOM IT Helpdesk - Laptop Won't Turn On Fix
color 0C
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Power Issue Diagnostic
echo  ============================================
echo.
echo  [1/3]  Power system check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$batt=Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue; if($batt){Write-Host '    Battery Status:' $batt.BatteryStatus; Write-Host '    Charge:' ($batt.EstimatedChargeRemaining.ToString() + '%%')}else{Write-Host '    Battery info: Run as admin for battery details'}"
echo.
echo  [2/3]  Recent shutdown events check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$events=Get-EventLog -LogName System -InstanceId 41,1074,6006,6008 -Newest 3 -ErrorAction SilentlyContinue; if($events){$events|ForEach-Object{Write-Host '   '$_.TimeGenerated.ToString('dd/MM HH:mm')'-'$_.Message.Substring(0,[Math]::Min(60,$_.Message.Length))}}else{Write-Host '    No recent shutdown events found'}"
echo.
echo  [3/3]  Power supply check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$cs=Get-CimInstance Win32_ComputerSystem; Write-Host '    Power State:' $cs.PowerState; Write-Host '    System:' $cs.Model; Write-Host '    Uptime:' ([Math]::Round((Get-Date - (gcim Win32_OperatingSystem).LastBootUpTime).TotalHours,1)) 'hours'"
echo.
echo  ============================================
echo    Agar laptop on nahi ho raha:
echo.
echo    STEP 1 - Hard Reset:
echo    Power button 30 sec HOLD karo, phir chodo
echo    10 sec wait karo, dubara press karo
echo.
echo    STEP 2 - Battery drain:
echo    Charger nikalo, power 30 sec hold karo
echo    Charger lagao, 30 sec wait, power on karo
echo.
echo    STEP 3 - Ye bhi try karo:
echo    Charger alag socket mein lagao
echo    LED light aa rahi hai? (charging indicator)
echo.
echo    Kuch nahi hua - hardware issue hai:
echo  ============================================
echo.
pause
