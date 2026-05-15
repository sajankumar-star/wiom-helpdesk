@echo off
title WIOM IT Helpdesk - Printer Fix
color 09
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Printer Auto-Fix
echo  ============================================
echo.
echo  [1/3]  Print spooler restart kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Stop-Service -Name 'Spooler' -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2; Get-ChildItem 'C:\Windows\System32\spool\PRINTERS' -ErrorAction SilentlyContinue|Remove-Item -Force -ErrorAction SilentlyContinue; Start-Service -Name 'Spooler' -ErrorAction SilentlyContinue; Write-Host '    Print Spooler restarted + queue cleared'"
echo.
echo  [2/3]  Connected printers check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$printers=Get-Printer -ErrorAction SilentlyContinue; if($printers){$printers|ForEach-Object{Write-Host '    Printer:' $_.Name '| Status:' $_.PrinterStatus}}else{Write-Host '    No printers found — add printer from Settings'}"
echo.
echo  [3/3]  Printer settings khol rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Start-Process 'ms-settings:printers'; Write-Host '    Printer Settings opened'"
echo.
echo  ============================================
echo    DONE! Print Spooler restart kiya.
echo.
echo    Abhi print try karo. Agar nahi ho raha:
echo    1. Printer ON hai aur connected hai?
echo    2. Correct printer select kiya hua hai?
echo    3. Printer Settings -> printer pe right-click ->
echo       "Set as default printer" karo
echo    4. Printer settings mein "Print test page" try karo
echo    5. USB cable/network cable check karo
echo.
echo    Network printer connect karna hai ya driver chahiye:
echo    IT Helpdesk: Slack pe ticket raise karo
echo  ============================================
echo.
pause
