@echo off
title WIOM IT Helpdesk - Word / Excel Fix
color 09
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Word/Excel Auto-Fix
echo  ============================================
echo.
echo  [1/3]  Office processes restart kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$office=Get-Process -Name 'WINWORD','EXCEL','POWERPNT','ONENOTE','OUTLOOK','OfficeClickToRun' -ErrorAction SilentlyContinue; $c=$office.Count; $office|ForEach-Object{try{Stop-Process -Id $_.Id -Force}catch{}}; Start-Sleep -Seconds 2; Write-Host '   '$c 'Office processes closed'"
echo.
echo  [2/3]  Office temp files clear kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$paths=@([Environment]::GetFolderPath('LocalApplicationData')+'\Microsoft\Office\16.0\OfficeFileCache',[Environment]::GetFolderPath('Temp')); $freed=0; foreach($p in $paths){if(Test-Path $p){$size=(Get-ChildItem $p -Recurse -ErrorAction SilentlyContinue -Filter '*.tmp'|Measure-Object Length -Sum).Sum; Get-ChildItem $p -Filter '*.tmp' -ErrorAction SilentlyContinue|Remove-Item -Force -ErrorAction SilentlyContinue; $freed+=$size}}; Write-Host '    Office temp files cleared:' ([Math]::Round($freed/1MB,1)) 'MB'"
echo.
echo  [3/3]  Office repair option check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$office=Get-ItemProperty HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\* -ErrorAction SilentlyContinue|Where-Object{$_.DisplayName -match 'Microsoft Office|Microsoft 365'}|Select-Object -First 1; if($office){Write-Host '    Office found:' $office.DisplayName; Write-Host '    Version:' $office.DisplayVersion}else{Write-Host '    Microsoft Office not found — may not be installed'}"
echo.
echo  ============================================
echo    DONE! Office processes restart kiye.
echo.
echo    Word/Excel dobara kholo. Agar nahi khulta:
echo    1. Safe Mode mein open karo:
echo       Win+R -> winword /safe (ya excel /safe)
echo    2. Control Panel -> Programs -> Office ->
echo       Change -> Quick Repair
echo    3. Office license check karo:
echo       File -> Account -> Product Information
echo.
echo    Agar "Not Licensed" dikh raha hai: ticket raise karo
echo  ============================================
echo.
pause
