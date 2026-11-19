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

function Say([string]$text) {
  $line = '{0:yyyy-MM-dd HH:mm:ss.f} {1}' -f (Get-Date), $text
  $line
  try { Add-Content -Path $file -Value $line -Encoding ascii } catch { }
}

$prev = $null
while ($true) {
  try {
    # one line per identity, e.g. "0A73:003A OK" or "0A4A:AC1E Error"
    $now = Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
      Where-Object { $_.InstanceId -match '^USB\\VID_(0A4A|0A73)&PID_([0-9A-F]{4})\\' } |
      ForEach-Object {
        $null = $_.InstanceId -match '^USB\\VID_([0-9A-F]{4})&PID_([0-9A-F]{4})\\'
        '{0}:{1} {2}' -f $Matches[1], $Matches[2], $_.Status
      } |
      Sort-Object
    $cur = if ($now) { $now -join ', ' } else { 'none' }
    if ($cur -ne $prev) {
      Say $cur
      $prev = $cur
    }
  } catch {
    # a passing CIM error must not end the watch
    Say ("read failed: " + $_.Exception.Message)
  }
  Start-Sleep -Milliseconds $IntervalMs
}
