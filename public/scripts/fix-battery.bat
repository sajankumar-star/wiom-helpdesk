@echo off
title WIOM IT Helpdesk - Battery / Charging Fix
color 0E
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Battery Auto-Fix
echo  ============================================
echo.
echo  [1/3]  Battery status check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$batt=Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue; if($batt){$status=@{1='Discharging';2='AC Power (Charging)';3='Fully Charged';4='Low';5='Critical';6='Charging+High';7='Charging+Low';8='Charging+Critical';9='Unknown';10='Partially Charged'}; $s=$status[$batt.BatteryStatus]; if(-not $s){$s='Unknown'}; Write-Host '    Battery Status:' $s; Write-Host '    Charge Level:' ($batt.EstimatedChargeRemaining.ToString() + '%%'); Write-Host '    Time Remaining:' $batt.EstimatedRunTime 'min'}else{Write-Host '    Battery info not available - charger connected hai ya battery issue hai'}"
echo.
echo  [2/3]  Power settings optimize kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "powercfg /change standby-timeout-ac 0; powercfg /change hibernate-timeout-ac 0; powercfg /setactive SCHEME_BALANCED; Write-Host '    Power plan: Balanced, Sleep: Disabled (charging better hoga)'"
echo.
echo  [3/3]  Battery report generate kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$report='C:\Users\Public\battery-report.html'; powercfg /batteryreport /output $report /duration 7 2>$null; if(Test-Path $report){Start-Process $report; Write-Host '    Battery report browser mein khul gaya!'}else{Write-Host '    Battery report: Run as Administrator for full report'}"
echo.
echo  ============================================
echo    DONE! Battery report browser mein khul gaya.
echo.
echo    Charging nahi ho rahi? Try karo:
echo    1. Charger dono side se firmly lagao
echo    2. Alag power socket try karo
echo    3. Charger cable check karo (koi damage?)
echo    4. Laptop band karo, charger lagao, on karo
echo    5. LED indicator check karo (orange = charging)
echo.
echo    Battery 80%% par nahi jaati:
echo    Battery degraded hai - replacement ticket raise karo
echo  ============================================
echo.
pause
