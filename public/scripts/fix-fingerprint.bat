@echo off
title WIOM IT Helpdesk - Fingerprint Fix
color 0D
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Fingerprint Auto-Fix
echo  ============================================
echo.
echo  [1/3]  Fingerprint service restart kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Restart-Service -Name 'WbioSrvc' -Force -ErrorAction SilentlyContinue; Write-Host '    Biometric service restarted'"
echo.
echo  [2/3]  Fingerprint device check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$fp=Get-PnpDevice|Where-Object{$_.Class -eq 'Biometric'}|Select-Object -First 1; if($fp){Write-Host '    Fingerprint reader:' $fp.FriendlyName '|' $fp.Status}else{Write-Host '    Fingerprint reader not found'}"
echo.
echo  [3/3]  Windows Hello Settings khol rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Start-Process 'ms-settings:signinoptions-launchfingerprintenrollment'; Write-Host '    Fingerprint setup opened'"
echo.
echo  ============================================
echo    DONE! Fingerprint settings khuli hain.
echo.
echo    Settings mein:
echo    Remove -> Add fingerprint again
echo    3-4 baar enroll karo same finger ko
echo    (better recognition ke liye)
echo.
echo    Agar reader nahi dikh raha: ticket raise
echo  ============================================
echo.
pause
