@echo off
title WIOM IT Helpdesk - WiFi Password
color 0A
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - WiFi Password Info
echo  ============================================
echo.
echo  WIOM Office WiFi Networks:
echo  ==========================================
echo    Network 1: spartans500
echo    Password : spartans500
echo    Works on : Ground Floor AND First Floor
echo  ------------------------------------------
echo    Network 2: wiom office 5g test
echo    Password : spartans500
echo    Works on : 5GHz band (faster speed)
echo  ==========================================
echo.
echo  [Auto] Saved WiFi passwords check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "netsh wlan show profiles | Select-String 'All User Profile' | ForEach-Object { $n=($_ -replace '.*: ','').Trim(); $p=(netsh wlan show profile name=$n key=clear 2>$null | Select-String 'Key Content') -replace '.*: ',''; if($p){Write-Host ('    Network: '+$n+' | Password: '+$p.Trim())} }"
echo.
echo  [Auto] Ab WiFi se connect kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$n1=(netsh wlan show profiles|Select-String 'spartans500'); $n2=(netsh wlan show profiles|Select-String 'wiom office 5g test'); if($n2){netsh wlan connect name='wiom office 5g test' 2>$null; Write-Host '    wiom office 5g test se connect kiya!'}elseif($n1){netsh wlan connect name='spartans500' 2>$null; Write-Host '    spartans500 se connect kiya!'}else{Write-Host '    Koi saved WiFi nahi mili - manually connect karo'}"
echo.
echo  ============================================
echo    Manual steps (agar auto nahi hua):
echo    1. Taskbar WiFi icon click karo
echo    2. "wiom office 5g test" ya "spartans500" select karo
echo    3. Password: spartans500
echo    4. Connect click karo
echo.
echo    Ab bhi nahi hua:
echo    1. WiFi toggle OFF, phir ON karo
echo    2. Laptop restart karo
echo  ============================================
echo.
pause
