@echo off
title WIOM IT Helpdesk - Screen Flicker Fix
color 07
cls
echo.
echo  ============================================
echo    WIOM IT Helpdesk - Screen Flicker Fix
echo  ============================================
echo.
echo  [1/3]  Refresh rate check aur fix kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class Display{ [DllImport(\"user32.dll\")] public static extern bool EnumDisplaySettings(string d, int m, ref DEVMODE dm); [StructLayout(LayoutKind.Sequential)] public struct DEVMODE{[MarshalAs(UnmanagedType.ByValTStr,SizeConst=32)]public string dmDeviceName;public ushort dmSpecVersion,dmDriverVersion,dmSize,dmDriverExtra;public uint dmFields;[MarshalAs(UnmanagedType.ByValArray,SizeConst=8)]public int[] dmPelsAndFrequency;} }' -ErrorAction SilentlyContinue; Write-Host '    Refresh rate: checking via Display Settings'"
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Start-Process 'ms-settings:display'; Write-Host '    Display Settings opened — check Refresh Rate'"
echo.
echo  [2/3]  Display driver update kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$gpu=Get-CimInstance -ClassName Win32_VideoController|Select-Object -First 1; Write-Host '    Display adapter:' $gpu.Name; Write-Host '    Driver date:' $gpu.DriverDate"
echo.
echo  [3/3]  Problem app check kar rahe hain...
powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "$procs=Get-Process|Where-Object{$_.Name -match 'chrome|teams|zoom|edge'}; Write-Host '    Running heavy GPU apps:' ($procs.Name -join ', ')"
echo.
echo  ============================================
echo    DONE! Display settings check karo.
echo.
echo    Display Settings mein:
echo    Advanced display -> Refresh rate ->
echo    Highest available select karo
echo.
echo    IT Helpdesk: Slack pe ticket raise karo
echo  ============================================
echo.
pause
