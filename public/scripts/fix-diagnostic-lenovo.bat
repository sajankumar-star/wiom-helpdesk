@echo off
title WIOM IT Helpdesk - Lenovo Hardware Diagnostic
color 09
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Lenovo Hardware Diagnostic
echo  ============================================
echo.
echo  [1/3]  Lenovo Vantage check/open kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$lv=Get-Process -Name 'LenovoVantage','Vantage' -ErrorAction SilentlyContinue; if($lv){Write-Host '    Lenovo Vantage already running'}else{try{Start-Process 'lenovovantage:'; Write-Host '    Lenovo Vantage opened via URI'}catch{$paths=@('C:\Program Files (x86)\Lenovo\VantageService\LenovoVantage.exe','C:\Program Files\Lenovo\VantageService\LenovoVantage.exe'); $found=$false; foreach($p in $paths){if(Test-Path $p){Start-Process $p; $found=$true; Write-Host '    Lenovo Vantage opened'; break}}; if(-not $found){Write-Host '    Lenovo Vantage nahi mila — Microsoft Store se install karo'; Start-Process 'ms-windows-store://pdp/?productid=9WZDNCRFJ4MV'; Write-Host '    Microsoft Store opened for Lenovo Vantage'}}}"
echo.
echo  [2/3]  Lenovo Diagnostics tool check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$diag=@('C:\Program Files (x86)\Lenovo\Lenovo Diagnostics\ldiagn.exe','C:\Program Files\Lenovo\Lenovo Diagnostics\ldiagn.exe'); $found=$false; foreach($p in $diag){if(Test-Path $p){Start-Process $p; $found=$true; Write-Host '    Lenovo Diagnostics opened'; break}}; if(-not $found){Write-Host '    Lenovo Diagnostics: Vantage app mein hai (Hardware Settings -> Diagnostics)'}"
echo.
echo  [3/3]  Lenovo system info aur serial number...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$bios=Get-CimInstance Win32_BIOS; $cs=Get-CimInstance Win32_ComputerSystem; $cpu=Get-CimInstance Win32_Processor|Select-Object -First 1; Write-Host '    Serial No:' $bios.SerialNumber; Write-Host '    Model:' $cs.Model; Write-Host '    CPU:' $cpu.Name; Write-Host '    RAM:' ([Math]::Round($cs.TotalPhysicalMemory/1GB,1)) 'GB'; Start-Process ('https://pcsupport.lenovo.com/us/en/warranty-lookup#/'); Write-Host '    Lenovo warranty page opened'"
echo.
echo  ============================================
echo    DONE!
echo.
echo    Lenovo Vantage mein:
echo    Hardware Settings -> Diagnostics ->
echo    "Run All" ya specific test select karo
echo    (Battery / Storage / Memory test karo)
echo.
echo    Warranty check: pcsupport.lenovo.com/warranty
echo    (Serial No copy karke paste karo)
echo.
echo  ============================================
echo.
pause
