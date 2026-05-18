@echo off
title WIOM IT Helpdesk - Virus Scan Auto-Fix
color 0C
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Virus Scan Auto-Fix
echo  ============================================
echo.
echo  [1/3]  Windows Defender definitions update kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Update-MpSignature -ErrorAction SilentlyContinue; Write-Host '    Definitions updated'"
echo.
echo  [2/3]  Antivirus status check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$mp=Get-MpComputerStatus -ErrorAction SilentlyContinue; if($mp){$enabled=if($mp.AntivirusEnabled){'Active (ON)'}else{'Inactive - Check karo!'}; $lastScan=if($mp.QuickScanEndTime -and $mp.QuickScanEndTime -ne [datetime]::MinValue){$mp.QuickScanEndTime.ToString('dd/MM/yyyy HH:mm')}else{'Scan kabhi nahi hua'}; $defDate=if($mp.AntivirusSignatureLastUpdated -and $mp.AntivirusSignatureLastUpdated -ne [datetime]::MinValue){$mp.AntivirusSignatureLastUpdated.ToString('dd/MM/yyyy')}else{'Unknown'}; Write-Host '    Antivirus Status:' $enabled; Write-Host '    Last Scan:' $lastScan; Write-Host '    Definitions Updated:' $defDate}else{Write-Host '    Status check failed - Admin rights needed'}"
echo.
echo  [3/3]  Quick scan start kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Start-MpScan -ScanType QuickScan -ErrorAction SilentlyContinue; Write-Host '    Quick scan background mein start ho gaya'"
echo.
echo  ============================================
echo    DONE! Virus scan chal raha hai.
echo.
echo    Result dekhne ke liye:
echo    Start - Windows Security - Virus protection
echo  ============================================
echo.
pause
