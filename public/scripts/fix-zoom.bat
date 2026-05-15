@echo off
title WIOM IT Helpdesk - Zoom Fix
color 0B
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Zoom Auto-Fix
echo  ============================================
echo.
echo  [1/3]  Zoom restart kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$z=Get-Process -Name 'Zoom','CptHost','zCrashReport' -ErrorAction SilentlyContinue; $c=$z.Count; $z|ForEach-Object{try{Stop-Process -Id $_.Id -Force}catch{}}; Start-Sleep -Seconds 2; Write-Host '   '$c 'Zoom processes closed'"
echo.
echo  [2/3]  Zoom cache clear kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$paths=@([Environment]::GetFolderPath('AppData')+'\Zoom\data',[Environment]::GetFolderPath('AppData')+'\Zoom\logs'); $cleared=0; foreach($p in $paths){if(Test-Path $p){Get-ChildItem $p -ErrorAction SilentlyContinue|Remove-Item -Recurse -Force -ErrorAction SilentlyContinue; $cleared++}}; Write-Host '   '$cleared 'Zoom folders cleared'"
echo.
echo  [3/3]  Camera aur mic permission check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Start-Process 'ms-settings:privacy-webcam'; Write-Host '    Camera privacy settings opened'"
echo.
echo  ============================================
echo    DONE! Zoom clear kiya.
echo.
echo    Abhi Zoom open karo:
echo    Start -> Zoom -> Open
echo.
echo    Agar Zoom join nahi ho raha:
echo    1. Browser se join karo (zoom.us/j/...)
echo    2. Zoom uninstall -> reinstall karo
echo    3. Antivirus temporarily off karke try karo
echo.
echo  ============================================
echo.
pause
