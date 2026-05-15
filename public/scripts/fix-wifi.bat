@echo off
title WIOM IT Helpdesk - WiFi Fix
color 0B
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - WiFi Auto-Fix
echo  ============================================
echo.
echo  WiFi adapter reset kar rahe hain...
echo  Kuch nahi karna — 10 seconds wait karo!
echo.
echo  ============================================
echo.

echo  [1/3]  WiFi adapter dhundh rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command ^
  "$a = (Get-NetAdapter | Where-Object {$_.InterfaceDescription -match 'Wi-Fi|Wireless|WLAN|802.11'} | Select-Object -First 1).Name; if($a){Write-Host '    Adapter found:' $a}else{$a='Wi-Fi'; Write-Host '    Using default: Wi-Fi'}"
echo.

echo  [2/3]  WiFi band kar rahe hain (3 sec wait)...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command ^
  "$a = (Get-NetAdapter | Where-Object {$_.InterfaceDescription -match 'Wi-Fi|Wireless|WLAN|802.11'} | Select-Object -First 1).Name; if(-not $a){$a='Wi-Fi'}; Disable-NetAdapter -Name $a -Confirm:$false -ErrorAction SilentlyContinue; Start-Sleep -Seconds 3; Enable-NetAdapter -Name $a -Confirm:$false -ErrorAction SilentlyContinue; Write-Host '    WiFi reset complete'"
echo.

echo  [3/3]  Connection check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command ^
  "Start-Sleep -Seconds 2; $r = Test-Connection 8.8.8.8 -Count 1 -Quiet -ErrorAction SilentlyContinue; if($r){Write-Host '    Internet connected!'}else{Write-Host '    WiFi reset hua. Ab network select karo: spartans500'}"
echo.

echo  ============================================
echo.
echo    DONE! WiFi reset ho gaya.
echo.
echo    Ab taskbar se WiFi network select karo:
echo    Network name: Wiom
echo    Password: spartans500
echo.
echo    IT Helpdesk: Slack pe ticket raise karo
echo.
echo  ============================================
echo.
pause
