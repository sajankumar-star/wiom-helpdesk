@echo off
title WIOM IT Helpdesk - Camera Fix
color 0D
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Camera Auto-Fix
echo  ============================================
echo.
echo  [1/3]  Camera privacy permission ON kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Set-ItemProperty -Path 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\webcam' -Name 'Value' -Value 'Allow' -ErrorAction SilentlyContinue; Write-Host '    Camera privacy: Allowed'"
echo.
echo  [2/3]  Camera driver check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$cam=Get-PnpDevice|Where-Object{$_.Class -eq 'Camera' -or $_.FriendlyName -match 'camera|webcam'}|Select-Object -First 1; if($cam){if($cam.Status -ne 'OK'){Enable-PnpDevice -InstanceId $cam.InstanceId -Confirm:$false -ErrorAction SilentlyContinue; Write-Host '    Camera enabled:' $cam.FriendlyName}else{Write-Host '    Camera OK:' $cam.FriendlyName}}else{Write-Host '    Camera device not found — may need driver'}"
echo.
echo  [3/3]  Windows Camera app khol rahe hain (test)...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Start-Process 'microsoft.windows.camera:'; Write-Host '    Camera app opened for test'"
echo.
echo  ============================================
echo    DONE! Camera test kar ke dekho.
echo.
echo    Agar Windows Camera app mein kaam kare
echo    but Teams mein na kare:
echo    Teams -> Settings -> Devices -> Camera
echo  ============================================
echo.
pause
