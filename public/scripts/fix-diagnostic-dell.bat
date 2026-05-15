@echo off
title WIOM IT Helpdesk - Dell Hardware Diagnostic
color 09
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Dell Hardware Diagnostic
echo  ============================================
echo.
echo  [1/3]  Dell SupportAssist check/open kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$sa=Get-Process -Name 'SupportAssist','SupportAssistAgent' -ErrorAction SilentlyContinue; if($sa){Write-Host '    Dell SupportAssist already running'}else{$paths=@('C:\Program Files\Dell\SupportAssistAgent\bin\SupportAssist.exe','C:\Program Files (x86)\Dell\SupportAssistAgent\bin\SupportAssist.exe','C:\Program Files\Dell\SupportAssist\pcdrstarter.exe'); $found=$false; foreach($p in $paths){if(Test-Path $p){Start-Process $p; $found=$true; Write-Host '    Dell SupportAssist opened'; break}}; if(-not $found){Write-Host '    Dell SupportAssist nahi mila'; Start-Process 'https://www.dell.com/support/home/drivers/SupportAssistInstall'; Write-Host '    Dell download page opened'}}"
echo.
echo  [2/3]  Dell Service Tag aur system info collect kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$bios=Get-CimInstance Win32_BIOS; $cs=Get-CimInstance Win32_ComputerSystem; $cpu=Get-CimInstance Win32_Processor|Select-Object -First 1; Write-Host '    Service Tag (Serial):' $bios.SerialNumber; Write-Host '    Model:' $cs.Model; Write-Host '    CPU:' $cpu.Name; Write-Host '    RAM:' ([Math]::Round($cs.TotalPhysicalMemory/1GB,1)) 'GB'; $warrantyUrl='https://www.dell.com/support/home/?s=BSD&ServiceTag='+$bios.SerialNumber; Write-Host '    Warranty URL:' $warrantyUrl"
echo.
echo  [3/3]  Dell warranty page khol rahe hain (Service Tag pre-filled)...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$sn=(Get-CimInstance Win32_BIOS).SerialNumber; $url='https://www.dell.com/support/home/?s=BSD&ServiceTag='+$sn; Start-Process $url; Write-Host '    Dell warranty page opened with your Service Tag'"
echo.
echo  ============================================
echo    DONE!
echo.
echo    Dell SupportAssist mein:
echo    "Run Hardware Test" click karo
echo    Ya "Check for issues" select karo
echo    Full scan: 30-45 min lagega
echo.
echo    Aapki warranty page browser mein khul gayi hai
echo    (Service Tag automatically fill hua hai)
echo.
echo  ============================================
echo.
pause
