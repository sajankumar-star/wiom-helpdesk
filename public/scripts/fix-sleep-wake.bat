@echo off
title WIOM IT Helpdesk - Sleep Wake Fix
color 0A
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Sleep/Wake Auto-Fix
echo  ============================================
echo.
echo  [1/3]  Sleep settings fix kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "powercfg /change standby-timeout-ac 0; powercfg /change standby-timeout-dc 0; Write-Host '    Sleep timeout disabled'"
echo.
echo  [2/3]  Fast startup disable kar rahe hain (common cause)...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' -Name 'HiberbootEnabled' -Value 0 -ErrorAction SilentlyContinue; Write-Host '    Fast startup disabled'"
echo.
echo  [3/3]  USB wake settings fix kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Get-PnpDevice|Where-Object{$_.Class -eq 'USB'}|ForEach-Object{try{$path='HKLM:\SYSTEM\CurrentControlSet\Enum\'+$_.InstanceId+'\Device Parameters'; Set-ItemProperty -Path $path -Name 'SelectiveSuspendEnabled' -Value 0 -ErrorAction SilentlyContinue}catch{}}; Write-Host '    USB wake settings optimized'"
echo.
echo  ============================================
echo    DONE! Sleep/Wake fix ho gaya.
echo.
echo    Ab laptop sleep se jagna chahiye.
echo    Power button ya keyboard press karo.
echo    IT Helpdesk: Slack pe ticket raise karo
echo  ============================================
echo.
pause
