@echo off
title WIOM IT Helpdesk - HP Hardware Diagnostic
color 09
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - HP Hardware Diagnostic
echo  ============================================
echo.
echo  [1/3]  HP Support Assistant check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$hpsa=Get-Process -Name 'HPSupportSolutionsFramework','HPSA','HPDiagnostics' -ErrorAction SilentlyContinue; if($hpsa){Write-Host '    HP Support Assistant already running'}else{$paths=@('C:\Program Files (x86)\HP\HP Support Framework\HPSF.exe','C:\Program Files\HP\HP Support Framework\HPSF.exe','C:\Program Files (x86)\Hewlett-Packard\HP Support Framework\HPSF.exe'); $found=$false; foreach($p in $paths){if(Test-Path $p){Start-Process $p; $found=$true; Write-Host '    HP Support Assistant opened:' $p; break}}; if(-not $found){Write-Host '    HP Support Assistant not found — opening HP website'}}"
echo.
echo  [2/3]  HP PC Hardware Diagnostics (UEFI tool) khol rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$hpdiag=@('C:\Program Files (x86)\HP\HP PC Hardware Diagnostics Windows\HPDiagnosticsWindows.exe','C:\Program Files\HP\HP PC Hardware Diagnostics Windows\HPDiagnosticsWindows.exe'); $found=$false; foreach($p in $hpdiag){if(Test-Path $p){Start-Process $p; $found=$true; Write-Host '    HP Diagnostics tool opened'; break}}; if(-not $found){Write-Host '    HP Diagnostics Windows app nahi mili'; Start-Process 'https://support.hp.com/us-en/help/hp-pc-hardware-diagnostics-windows'; Write-Host '    HP download page opened'}"
echo.
echo  [3/3]  Laptop system info collect kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$cs=Get-CimInstance Win32_ComputerSystem; $bios=Get-CimInstance Win32_BIOS; $cpu=Get-CimInstance Win32_Processor|Select-Object -First 1; Write-Host '    Model:' $cs.Model; Write-Host '    Serial No:' $bios.SerialNumber; Write-Host '    CPU:' $cpu.Name; Write-Host '    RAM:' ([Math]::Round($cs.TotalPhysicalMemory/1GB,1)) 'GB'"
echo.
echo  ============================================
echo    DONE!
echo.
echo    HP Diagnostics mein:
echo    "Run All Tests" select karo (20-30 min lagega)
echo    Ya specific test: Battery / Storage / Memory
echo.
echo    Warranty check: support.hp.com/checkwarranty
echo    (Aapka Serial No upar dikh raha hai)
echo.
echo    IT Helpdesk: Slack pe ticket raise karo
echo  ============================================
echo.
pause
