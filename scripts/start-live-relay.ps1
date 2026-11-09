param(
  [switch]$ReadSerial,
  [ValidateSet('serial', 'stdin', 'infoesp')][string]$InputMode = 'serial'
)

$ErrorActionPreference = 'Stop'

if ($ReadSerial) {
  # Private child protocol: stdout is raw serial, stderr contains fixed status
  # markers only. Never send device commands or toggle DTR/RTS by default.
  $relaySerial = $null
  try {
    $relayPortName = $env:SMARTTRACK_SERIAL_PORT
    if ([string]::IsNullOrWhiteSpace($relayPortName)) { $relayPortName = 'COM14' }
    if ($relayPortName -notmatch '^COM[1-9][0-9]*$') { throw 'Invalid serial port' }
    $relaySerial = [System.IO.Ports.SerialPort]::new($relayPortName, 115200, [System.IO.Ports.Parity]::None, 8, [System.IO.Ports.StopBits]::One)
    $relaySerial.DtrEnable = $false
    $relaySerial.RtsEnable = $false
    $relaySerial.Handshake = [System.IO.Ports.Handshake]::None
    $relaySerial.ReadTimeout = 250
    $relaySerial.WriteTimeout = 250
    $relaySerial.ReadBufferSize = 65536
    $relaySerial.Encoding = [System.Text.Encoding]::ASCII
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $relaySerial.Open()
    [Console]::Error.WriteLine('SERIAL_CONNECTED')
    $relayParentId = 0
    [void][int]::TryParse($env:SMARTTRACK_RELAY_PARENT_PID, [ref]$relayParentId)
    while ($relaySerial.IsOpen) {
      if ($relayParentId -gt 0) {
        try {
          $relayParentProcess = [System.Diagnostics.Process]::GetProcessById($relayParentId)
          if ($relayParentProcess.HasExited) { break }
          $relayParentProcess.Dispose()
        } catch { break }
      }
      $relayChunk = $relaySerial.ReadExisting()
      if ($relayChunk.Length -gt 0) {
        [Console]::Out.Write($relayChunk)
        [Console]::Out.Flush()
      } else {
        Start-Sleep -Milliseconds 20
      }
    }
  } catch {
    [Console]::Error.WriteLine('SERIAL_ERROR:unavailable')
    exit 1
  } finally {
    if ($null -ne $relaySerial) {
      if ($relaySerial.IsOpen) { $relaySerial.Close() }
      $relaySerial.Dispose()
    }
  }
  exit 0
}

if ([string]::IsNullOrWhiteSpace($env:SMARTTRACK_RELAY_SECRET) -or $env:SMARTTRACK_RELAY_SECRET.Length -lt 32 -or $env:SMARTTRACK_RELAY_SECRET -match '\s') {
  throw 'Set SMARTTRACK_RELAY_SECRET to at least 32 non-whitespace characters in the process environment before starting the relay.'
}
$relayProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$relayLocalDirectory = Join-Path $relayProjectRoot '.local'
[void][System.IO.Directory]::CreateDirectory($relayLocalDirectory)
$relayNodePath = (Get-Command node.exe -ErrorAction Stop).Source
$relayEntryPath = Join-Path $PSScriptRoot 'live-relay.cjs'
$env:SMARTTRACK_RELAY_INPUT = $InputMode
if ([string]::IsNullOrWhiteSpace($env:SMARTTRACK_SERIAL_PORT)) { $env:SMARTTRACK_SERIAL_PORT = 'COM14' }

$relayProcess = Start-Process -FilePath $relayNodePath -ArgumentList @('"' + $relayEntryPath + '"') `
  -WorkingDirectory $relayProjectRoot -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput (Join-Path $relayLocalDirectory 'relay.stdout.log') `
  -RedirectStandardError (Join-Path $relayLocalDirectory 'relay.stderr.log')
Set-Content -LiteralPath (Join-Path $relayLocalDirectory 'relay.pid') -Value $relayProcess.Id -Encoding ASCII
Write-Output ('SmartTrack relay process started: ' + $relayProcess.Id)
