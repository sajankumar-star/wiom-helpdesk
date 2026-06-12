Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Threading;

public class WinAuto {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, int x, int y, uint d, int e);

    public static void Click(int x, int y) {
        SetCursorPos(x, y);
        Thread.Sleep(150);
        mouse_event(0x0002, x, y, 0, 0);
        Thread.Sleep(80);
        mouse_event(0x0004, x, y, 0, 0);
        Thread.Sleep(400);
    }

    public static void DoubleClick(int x, int y) {
        Click(x, y);
        Thread.Sleep(100);
        Click(x, y);
    }
}
"@

function Screenshot($path, $w=1100, $h=700) {
    Add-Type -AssemblyName System.Drawing -ErrorAction SilentlyContinue
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen(0, 0, 0, 0, [System.Drawing.Size]::new($w, $h))
    $g.Dispose()
    $bmp.Save($path)
    $bmp.Dispose()
}
