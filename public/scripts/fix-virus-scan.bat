@echo off
title WIOM IT Helpdesk - Virus Scan / Antivirus Fix
color 0C
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Virus Scan Auto-Fix
echo  ============================================
echo.
echo  [1/3]  Windows Defender quick scan start kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '    Starting Windows Defender quick scan...'; Start-MpScan -ScanType QuickScan -ErrorAction SilentlyContinue; Write-Host '    Scan started in background (few minutes lagenge)'"
echo.
echo  [2/3]  Windows Defender definitions update kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Update-MpSignature -ErrorAction SilentlyContinue; $mp=Get-MpComputerStatus -ErrorAction SilentlyContinue; if($mp){Write-Host '    Antivirus enabled:' $mp.AntivirusEnabled; Write-Host '    Last scan:' $mp.QuickScanEndTime; Write-Host '    Definitions:' $mp.AntivirusSignatureLastUpdated}else{Write-Host '    Windows Defender status check failed'}"
echo.
echo  [3/3]  Suspicious startup entries check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$safe=@('OneDrive','Teams','Discord','Slack','Zoom','Skype'); $all=Get-CimInstance -ClassName Win32_StartupCommand -ErrorAction SilentlyContinue; $susp=$all|Where-Object{$_.Name -notin $safe -and $_.Location -match 'HKCU|AppData'}; Write-Host '    Startup entries:' $all.Count 'found,'; if($susp.Count -gt 3){Write-Host '    '$susp.Count 'unknown startup apps detected — review manually'}else{Write-Host '    Startup looks clean'}"
echo.
echo  ============================================
echo    DONE! Virus scan started.
echo.
echo    Scan background mein chal raha hai.
echo    Windows Security app mein result dekhne ke liye:
echo    Start -> Windows Security -> Virus protection
echo.
echo    Suspicious activity agar dikh rahi hai:
echo    - Pop-ups aane lage hain
echo    - Browser home page change ho gayi
echo    - Unknown apps install hue hain
echo    IMMEDIATELY ticket raise karo — laptop band karo!
echo  ============================================
echo.
pause
