@echo off
title WIOM IT Helpdesk - App Crash Fix
color 0C
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - App Crash Auto-Fix
echo  ============================================
echo.
echo  [1/3]  Recent crash logs check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$crashes=Get-EventLog -LogName Application -EntryType Error -Newest 5 -Source 'Application Error' -ErrorAction SilentlyContinue; if($crashes){$crashes|ForEach-Object{Write-Host '   ' $_.TimeGenerated.ToString('dd/MM HH:mm') '-' $_.Message.Substring(0,[Math]::Min(60,$_.Message.Length))}}else{Write-Host '    No recent app crash logs found'}"
echo.
echo  [2/3]  Temp files aur crash reports clear kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$paths=@($env:TEMP,$env:TMP,'C:\Windows\Temp'); $freed=0; foreach($p in $paths){if(Test-Path $p){$size=(Get-ChildItem $p -Recurse -ErrorAction SilentlyContinue|Measure-Object Length -Sum).Sum; Get-ChildItem $p -Recurse -ErrorAction SilentlyContinue|Remove-Item -Recurse -Force -ErrorAction SilentlyContinue; $freed+=$size}}; Write-Host '    Temp cleared:' ([Math]::Round($freed/1MB,1)) 'MB freed'"
echo.
echo  [3/3]  Visual C++ runtime check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$vcredist=Get-ItemProperty HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*,HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\* -ErrorAction SilentlyContinue|Where-Object{$_.DisplayName -match 'Visual C\+\+'}|Select-Object DisplayName -First 5; if($vcredist){Write-Host '    Visual C++ found:'; $vcredist|ForEach-Object{Write-Host '   ' $_.DisplayName}}else{Write-Host '    Visual C++ runtimes may need install'}"
echo.
echo  ============================================
echo    DONE! App crash check kiya.
echo.
echo    App crash ho rahi hai? Try karo:
echo    1. App ko Run as Administrator karo
echo       (Right-click -> Run as administrator)
echo    2. App repair karo:
echo       Settings -> Apps -> [App name] -> Modify/Repair
echo    3. App reinstall karo (IT se permission leke)
echo    4. Windows update karo — bug fixes aate hain
echo.
echo    Agar specific app baar baar crash ho:
echo    IT Helpdesk: Slack pe ticket raise karo
echo  ============================================
echo.
pause
