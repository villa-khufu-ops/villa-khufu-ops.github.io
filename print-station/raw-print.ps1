# send a ready ESC/POS file straight to a Windows printer (RAW), so the driver does not resize it
param([string]$File, [string]$Printer)
$ErrorActionPreference = 'Stop'
if (-not $Printer) {
  $cfg = Join-Path $PSScriptRoot 'rec-printer.txt'
  if (Test-Path $cfg) { $Printer = (Get-Content $cfg -Raw).Trim() }
}
if (-not $Printer) {
  $usb = @(Get-Printer | Where-Object { $_.PortName -like 'USB*' -or $_.PortName -like 'COM*' })
  $pos = @($usb | Where-Object { $_.Name -match 'pos|receipt|thermal|80|58|xp|tm-|rongta|xprinter|bixolon|star|sewoo|gprinter' })
  if ($pos.Count -ge 1) { $Printer = $pos[0].Name } elseif ($usb.Count -ge 1) { $Printer = $usb[0].Name } else { Write-Output 'no-usb-printer'; exit 2 }
}
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class VKRaw {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public class DI { public string n; public string o; public string t; }
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool OpenPrinter(string p, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)] static extern int StartDocPrinter(IntPtr h, int l, [In] DI di);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int w);
  public static bool Send(string printer, byte[] data) {
    IntPtr h; if (!OpenPrinter(printer, out h, IntPtr.Zero)) return false;
    var di = new DI(); di.n = "Villa Khufu receipt"; di.t = "RAW"; bool ok = false;
    if (StartDocPrinter(h, 1, di) > 0) { if (StartPagePrinter(h)) { int w; ok = WritePrinter(h, data, data.Length, out w) && w == data.Length; EndPagePrinter(h); } EndDocPrinter(h); }
    ClosePrinter(h); return ok;
  }
}
"@
$ok = [VKRaw]::Send($Printer, [IO.File]::ReadAllBytes($File))
if ($ok) { Write-Output ('ok|' + $Printer); exit 0 } else { Write-Output ('fail|' + $Printer); exit 1 }
