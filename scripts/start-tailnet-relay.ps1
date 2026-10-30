param()
$ErrorActionPreference='Stop'
$relayRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$existing=Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 1935 -State Listen -ErrorAction SilentlyContinue
if($existing -and (Get-Process -Id $existing.OwningProcess).ProcessName -ne 'mediamtx') { throw 'Port 1935 is occupied by another program; it was not changed.' }
if($existing) { Write-Output 'RaidRift private RTMP receiver is already listening on 127.0.0.1:1935.'; exit 0 }
$relayExecutable=Join-Path $relayRoot '.tools/mediamtx-win/mediamtx.exe'
if(!(Test-Path -LiteralPath $relayExecutable)) { throw 'MediaMTX is missing. See docs/ANDROID_LAN_TEST.md for the verified package.' }
New-Item -ItemType Directory -Force -Path (Join-Path $relayRoot '.data') | Out-Null
$relayProcess=Start-Process -FilePath $relayExecutable -ArgumentList @('infra/tailnet-relay.yml') -WorkingDirectory $relayRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $relayRoot '.data/tailnet-relay.log') -RedirectStandardError (Join-Path $relayRoot '.data/tailnet-relay-error.log') -PassThru
Write-Output "Started private MediaMTX receiver (PID $($relayProcess.Id)). Uses the existing Tailscale forwards; no public listener or Twitch broadcast is created."
