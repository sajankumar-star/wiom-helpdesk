@echo off
title WIOM IT Helpdesk - Windows Update Fix
color 09
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Windows Update Fix
echo  ============================================
echo.
echo  [1/3]  Windows Update service restart kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Stop-Service -Name 'wuauserv','cryptSvc','bits','msiserver' -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2; Start-Service -Name 'wuauserv','cryptSvc','bits' -ErrorAction SilentlyContinue; Write-Host '    Windows Update services restarted'"
echo.
echo  [2/3]  Windows Update cache clear kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Stop-Service -Name 'wuauserv' -Force -ErrorAction SilentlyContinue; $path='C:\Windows\SoftwareDistribution\Download'; if(Test-Path $path){Get-ChildItem $path -ErrorAction SilentlyContinue|Remove-Item -Recurse -Force -ErrorAction SilentlyContinue; Write-Host '    Update cache cleared'}else{Write-Host '    Cache folder not found'}; Start-Service -Name 'wuauserv' -ErrorAction SilentlyContinue"
echo.
echo  [3/3]  Windows Update check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Start-Process 'ms-settings:windowsupdate'; Write-Host '    Windows Update Settings opened'"
echo.
echo  ============================================
echo    DONE! Windows Update fix kiya.
echo.
echo    Settings mein "Check for updates" click karo.
echo.
echo    Agar update stuck hai:
echo    1. Laptop restart karo (update complete ho sakta hai)
echo    2. Settings -> Windows Update -> Pause -> Resume
echo    3. Storage check karo (C: drive 10GB+ free hona chahiye)
echo.
echo    Agar update ke baad laptop slow hai:
echo    Settings -> Windows Update -> View update history ->
echo    Uninstall updates -> Last update remove karo
echo.
echo  ============================================
echo.
pause
