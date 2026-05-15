@echo off
title WIOM IT Helpdesk - Browser Fix
color 09
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Browser Auto-Fix
echo  ============================================
echo.
echo  [1/3]  Browser processes band kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$browsers=Get-Process -Name 'chrome','msedge','firefox','brave' -ErrorAction SilentlyContinue; $c=$browsers.Count; $browsers|ForEach-Object{try{Stop-Process -Id $_.Id -Force}catch{}}; Start-Sleep -Seconds 1; Write-Host '   '$c 'browser processes closed'"
echo.
echo  [2/3]  Chrome/Edge temp files clear kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$paths=@([Environment]::GetFolderPath('LocalApplicationData')+'\Google\Chrome\User Data\Default\Cache',[Environment]::GetFolderPath('LocalApplicationData')+'\Microsoft\Edge\User Data\Default\Cache'); $freed=0; foreach($p in $paths){if(Test-Path $p){$size=(Get-ChildItem $p -Recurse -ErrorAction SilentlyContinue|Measure-Object Length -Sum).Sum; Get-ChildItem $p -ErrorAction SilentlyContinue|Remove-Item -Recurse -Force -ErrorAction SilentlyContinue; $freed+=$size}}; Write-Host '    Cache cleared:' ([Math]::Round($freed/1MB,1)) 'MB freed'"
echo.
echo  [3/3]  DNS flush kar rahe hain (sites load hone ke liye)...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "ipconfig /flushdns | Out-Null; Write-Host '    DNS cache flushed — websites fresh load honge'"
echo.
echo  ============================================
echo    DONE! Browser fix kiya.
echo.
echo    Browser dobara kholo. Agar abhi bhi slow hai:
echo    1. Extensions disable karo (Settings->Extensions)
echo    2. Hardware acceleration off karo:
echo       Chrome Settings -> System -> Hardware Acc. OFF
echo    3. Incognito mode mein try karo (Ctrl+Shift+N)
echo    4. Browser reset karo:
echo       Settings -> Reset Settings -> Restore defaults
echo.
echo  ============================================
echo.
pause
