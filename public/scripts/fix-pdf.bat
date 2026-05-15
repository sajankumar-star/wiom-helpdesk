@echo off
title WIOM IT Helpdesk - PDF Fix
color 09
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - PDF Auto-Fix
echo  ============================================
echo.
echo  [1/3]  PDF processes restart kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$pdf=Get-Process -Name 'AcroRd32','Acrobat','FoxitReader','SumatraPDF' -ErrorAction SilentlyContinue; $c=$pdf.Count; $pdf|ForEach-Object{try{Stop-Process -Id $_.Id -Force}catch{}}; Write-Host '   '$c 'PDF processes closed'"
echo.
echo  [2/3]  Default PDF app check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$assoc=Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.pdf\UserChoice' -ErrorAction SilentlyContinue; if($assoc){Write-Host '    Default PDF app:' $assoc.Progid}else{Write-Host '    No default PDF app set'}; Start-Process 'ms-settings:defaultapps'; Write-Host '    Default Apps settings opened'"
echo.
echo  [3/3]  Windows Edge PDF (built-in) se try karo...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '    Microsoft Edge can open PDFs without any extra software'; Write-Host '    Right-click PDF file -> Open with -> Microsoft Edge'"
echo.
echo  ============================================
echo    DONE! PDF settings check kiye.
echo.
echo    PDF open karne ke tarike:
echo    1. Right-click PDF -> Open with -> Microsoft Edge
echo       (Edge built-in PDF reader hai, koi install nahi)
echo    2. Right-click -> Open with -> Choose another app
echo       -> Microsoft Edge select karo as default
echo    3. Agar specific PDF reader chahiye:
echo       Adobe Acrobat Reader free download kar sakte hain
echo       (IT permission required)
echo.
echo    IT Helpdesk: Slack pe ticket raise karo
echo  ============================================
echo.
pause
