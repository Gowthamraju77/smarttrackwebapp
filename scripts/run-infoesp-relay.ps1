param([string]$InfoEspUrl = 'http://192.168.1.35:4318/infoesp')

$ErrorActionPreference = 'Stop'
$relayRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$relayLocal = Join-Path $relayRoot '.local'
$relayConnection = Get-Content -LiteralPath (Join-Path $relayLocal 'device-link.json') -Raw | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($relayConnection.relaySecret)) { throw 'The local relay connection needs configuration.' }
$env:SMARTTRACK_RELAY_SECRET = $relayConnection.relaySecret
$env:SMARTTRACK_RELAY_INPUT = 'infoesp'
$env:SMARTTRACK_INFOESP_URL = $InfoEspUrl
$env:SMARTTRACK_RELAY_PORT = '4317'
$relayNode = (Get-Command node.exe -ErrorAction Stop).Source
# Run attached to the hidden scheduled task. No serial device is opened.
& $relayNode (Join-Path $PSScriptRoot 'live-relay.cjs') `
  1>> (Join-Path $relayLocal 'infoesp-relay.stdout.log') `
  2>> (Join-Path $relayLocal 'infoesp-relay.stderr.log')
exit $LASTEXITCODE
