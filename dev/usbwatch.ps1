# Watch the mixer's USB identity on this PC (#88): prints a line, with the time, whenever the set of
# present mixer USB devices changes: `0A73:003A` (Mackie's identity, LOUD's driver), `0A4A:AC1E`
# (Ploytec's fallback identity, Windows' code 10) or none. Also written to
# build/device-logs/usbwatch-<date>-<time>.txt. Reads only; sends nothing to the mixer. Stop with Ctrl+C.
#
#   powershell -ExecutionPolicy Bypass -File dev/usbwatch.ps1 [-IntervalMs 500]
#
# The PC's clock and the mixer's differ by up to ~0.5 s; dspserver's PI14 resets the USB chip
# (notes/hardware.md, "PI14 resets the USB chip"), so line a change up with the pin log's PI14.
param([int]$IntervalMs = 500)
$ErrorActionPreference = "Stop"

$dir = Join-Path (Split-Path -Parent $PSScriptRoot) "build\device-logs"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$file = Join-Path $dir ("usbwatch-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".txt")

$prev = $null
while ($true) {
  $now = Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
    Where-Object { $_.InstanceId -match '^USB\\VID_(0A4A|0A73)&PID_[0-9A-F]{4}\\' } |
    ForEach-Object { '{0}={1}' -f (($_.InstanceId -split '\\')[1]), $_.Status } |
    Sort-Object
  $cur = if ($now) { $now -join ' ' } else { 'none' }
  if ($cur -ne $prev) {
    $line = '{0:yyyy-MM-dd HH:mm:ss.f} {1}' -f (Get-Date), $cur
    $line
    Add-Content -Path $file -Value $line -Encoding ascii
    $prev = $cur
  }
  Start-Sleep -Milliseconds $IntervalMs
}
