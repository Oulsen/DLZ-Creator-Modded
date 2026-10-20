# The PC side of a dev card's network log (dev/netlog.sh on): receives its journal line by line over
# UDP and writes it to build/device-logs/netlog-<date>-<time>.txt (one file per run of this script,
# a marker line at each new start of the mixer), and shows it here. Stop with Ctrl+C.
#
#   powershell -ExecutionPolicy Bypass -File dev/netlog.ps1 [-Port 5140]
#
# Nothing arrives: Windows Firewall blocks the port. Once, in an administrator PowerShell:
#   New-NetFirewallRule -DisplayName "DLZ dev card log" -Direction Inbound -Protocol UDP -LocalPort 5140 -Action Allow
param([int]$Port = 5140)
$ErrorActionPreference = "Stop"

$dir = Join-Path (Split-Path -Parent $PSScriptRoot) "build\device-logs"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$file = Join-Path $dir ("netlog-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".txt")
$udp = New-Object System.Net.Sockets.UdpClient($Port)
# a start sends its first ~2000 lines at once, as soon as Wi-Fi is up
$udp.Client.ReceiveBufferSize = 8MB
$from = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, 0)
$out = New-Object System.IO.StreamWriter($file, $true, (New-Object System.Text.UTF8Encoding($false)))
$out.AutoFlush = $true
Write-Host "netlog: listening on UDP $Port, writing $file"
try {
  while ($true) {
    $line = [System.Text.Encoding]::UTF8.GetString($udp.Receive([ref]$from)).TrimEnd("`n")
    if ($line -match "Booting Linux on physical CPU") {
      $mark = "===== new start of the mixer, received " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + " ====="
      $out.WriteLine($mark)
      Write-Host $mark -ForegroundColor Cyan
    }
    $out.WriteLine($line)
    Write-Host $line
  }
} finally {
  $out.Close()
  $udp.Close()
}
