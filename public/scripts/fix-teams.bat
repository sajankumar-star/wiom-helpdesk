@echo off
title WIOM IT Helpdesk - Teams Fix
color 0E
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Teams Auto-Fix
echo  ============================================
echo.
echo  Teams cache clear kar rahe hain...
echo  Teams band ho jayega — dobara khulega fresh!
echo.
echo  ============================================
echo.

echo  [1/3]  Teams band kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command ^
  "Stop-Process -Name 'Teams' -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2; Write-Host '    Teams closed'"
echo.

echo  [2/3]  Teams cache delete kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command ^
  "$base = [System.IO.Path]::Combine($env:APPDATA,'Microsoft','Teams'); $folders = @('Cache','blob_storage','databases','GPUCache','IndexedDB','Local Storage','tmp'); $cleared=0; foreach($f in $folders){ $p = [System.IO.Path]::Combine($base,$f); if(Test-Path $p){ Remove-Item $p\* -Recurse -Force -ErrorAction SilentlyContinue; $cleared++ } }; Write-Host '   ' $cleared 'cache folders cleared'"
echo.

echo  [3/3]  Teams restart kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command ^
  "Start-Sleep -Seconds 1; Start-Process -FilePath ([System.IO.Path]::Combine($env:LOCALAPPDATA,'Microsoft','Teams','Update.exe')) -ArgumentList '--processStart Teams.exe' -ErrorAction SilentlyContinue; Write-Host '    Teams starting...'"
echo.

echo  ============================================
echo.
echo    DONE! Teams fresh start ho gaya.
echo.
echo    Calls/messages ab theek kaam karenge.
echo    Agar phir bhi issue: teams.microsoft.com
echo.
echo    IT Helpdesk: 9654244281 (9AM - 7PM)
echo.
echo  ============================================
echo.
pause
