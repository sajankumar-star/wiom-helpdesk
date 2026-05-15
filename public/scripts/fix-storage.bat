@echo off
title WIOM IT Helpdesk - Storage Cleanup
color 0A
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Storage Auto-Cleanup
echo  ============================================
echo.
echo  Laptop ki storage clean kar rahe hain...
echo  Kuch nahi karna — bas wait karo!
echo.
echo  ============================================
echo.

echo  [1/4]  Temp files delete kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command ^
  "Remove-Item $env:TEMP\* -Recurse -Force -ErrorAction SilentlyContinue; Write-Host '    User temp cleared'"

powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command ^
  "Remove-Item C:\Windows\Temp\* -Recurse -Force -ErrorAction SilentlyContinue; Write-Host '    Windows temp cleared'"
echo.

echo  [2/4]  Recycle Bin empty kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command ^
  "Clear-RecycleBin -Force -ErrorAction SilentlyContinue; Write-Host '    Recycle Bin emptied'"
echo.

echo  [3/4]  Browser cache check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command ^
  "$chromePath = [System.IO.Path]::Combine($env:LOCALAPPDATA,'Google','Chrome','User Data','Default','Cache'); if(Test-Path $chromePath){ Remove-Item $chromePath\* -Recurse -Force -ErrorAction SilentlyContinue; Write-Host '    Chrome cache cleared' }else{ Write-Host '    Chrome cache skip (not found)' }"
echo.

echo  [4/4]  Free space check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command ^
  "$free = [math]::Round((Get-PSDrive C).Free/1GB,1); $total = [math]::Round(((Get-PSDrive C).Free+(Get-PSDrive C).Used)/1GB,1); Write-Host '    C: Drive:' $free 'GB free of' $total 'GB total'"
echo.

echo  ============================================
echo.
echo    DONE! Storage cleanup complete.
echo.
echo    Agar C: abhi bhi 90%+ full hai:
echo    Type karo Slack mein: ticket bana do
echo.
echo.
echo  ============================================
echo.
pause
