@echo off
title WIOM IT Helpdesk - OneDrive Fix
color 09
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - OneDrive Auto-Fix
echo  ============================================
echo.
echo  [1/3]  OneDrive restart kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$od=Get-Process -Name 'OneDrive' -ErrorAction SilentlyContinue; if($od){Stop-Process -Name 'OneDrive' -Force -ErrorAction SilentlyContinue; Write-Host '    OneDrive stopped'; Start-Sleep -Seconds 3}else{Write-Host '    OneDrive was not running'}; $oneDrivePath=[Environment]::GetFolderPath('LocalApplicationData')+'\Microsoft\OneDrive\OneDrive.exe'; if(Test-Path $oneDrivePath){Start-Process $oneDrivePath; Write-Host '    OneDrive restarted'}else{Write-Host '    Starting from default path...'; Start-Process 'OneDrive.exe' -ErrorAction SilentlyContinue}"
echo.
echo  [2/3]  OneDrive sync status check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 3; $od=Get-Process -Name 'OneDrive' -ErrorAction SilentlyContinue; if($od){Write-Host '    OneDrive is running — sync should resume'}else{Write-Host '    OneDrive restart mein time lag raha hai...'}"
echo.
echo  [3/3]  OneDrive storage status check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$oneDriveFolder=[Environment]::GetFolderPath('UserProfile')+'\OneDrive'; if(Test-Path $oneDriveFolder){$size=(Get-ChildItem $oneDriveFolder -Recurse -ErrorAction SilentlyContinue|Measure-Object Length -Sum).Sum; Write-Host '    Local OneDrive folder size:' ([Math]::Round($size/1GB,2)) 'GB'}else{Write-Host '    OneDrive folder not found'}; Start-Process 'ms-settings:storagesense'; Write-Host '    Storage settings opened'"
echo.
echo  ============================================
echo    DONE! OneDrive restart kiya.
echo.
echo    Agar sync nahi ho raha:
echo    1. Taskbar mein OneDrive icon (cloud) pe click karo
echo    2. "Sync is paused" dikh raha hai -> Resume karo
echo    3. Error code dikh raha hai -> IT ko batao
echo    4. Settings -> Accounts -> sign-out -> sign-in karo
echo.
echo    Agar OneDrive storage full hai (5GB limit):
echo    onedrive.live.com pe jaao -> old files delete karo
echo    Ya IT se storage upgrade request karo
echo.
echo    IT Helpdesk: Slack pe ticket raise karo
echo  ============================================
echo.
pause
