@echo off
title WIOM IT Helpdesk - Website Not Opening Fix
color 09
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Website Fix
echo  ============================================
echo.
echo  [1/3]  DNS cache flush kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "ipconfig /flushdns | Out-Null; Write-Host '    DNS cache cleared - websites fresh load honge'"
echo.
echo  [2/3]  Browser cache clear kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$paths=@([Environment]::GetFolderPath('LocalApplicationData')+'\Google\Chrome\User Data\Default\Cache',[Environment]::GetFolderPath('LocalApplicationData')+'\Microsoft\Edge\User Data\Default\Cache'); $freed=0; foreach($p in $paths){if(Test-Path $p){$size=(Get-ChildItem $p -Recurse -ErrorAction SilentlyContinue|Measure-Object Length -Sum).Sum; Get-ChildItem $p -ErrorAction SilentlyContinue|Remove-Item -Recurse -Force -ErrorAction SilentlyContinue; $freed+=$size}}; Write-Host '    Browser cache cleared:' ([Math]::Round($freed/1MB,1)) 'MB'"
echo.
echo  [3/3]  Internet connection check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$ping=Test-Connection 8.8.8.8 -Count 1 -Quiet -ErrorAction SilentlyContinue; if($ping){Write-Host '    Internet: Connected OK'; Write-Host '    (Website IT policy se block ho sakti hai)'}else{Write-Host '    Internet: NOT connected - WiFi fix karo pehle'}"
echo.
echo  ============================================
echo    DONE! DNS aur cache clear ho gaya.
echo.
echo    Browser dobara kholo aur try karo.
echo.
echo    Agar website abhi bhi nahi khulti:
echo    1. Incognito mode try karo (Ctrl+Shift+N)
echo    2. Alag browser try karo (Chrome/Edge/Firefox)
echo    3. Mobile data se try karo
echo.
echo    Agar office policy se block hai:
echo    * IT se unblock request karo (ticket raise)
echo  ============================================
echo.
pause
