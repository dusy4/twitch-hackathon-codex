# Starts the open-vocabulary detector sidecar detached (hidden window) on 127.0.0.1:3420.
# Usage: powershell -File services/ov-detector/start.ps1 [-Python <venv python>] [-Log <file>] [-Port 3420]
param(
  [string]$Python = "E:\Hermes\venvs\raidrift-ov\Scripts\python.exe",
  [string]$Log = "E:\Hermes\tmp\rr\ov-detector.log",
  [int]$Port = 3420
)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($busy) { Write-Output "Port $Port already in use by PID $($busy[0].OwningProcess); not starting."; exit 0 }
New-Item -ItemType Directory -Force (Split-Path -Parent $Log) | Out-Null
if (-not $env:HF_HOME) { $env:HF_HOME = "E:/Hermes/cache/huggingface" }
# No HF_HUB_OFFLINE: transformers 5.x looks up the Swin backbone name on the Hub
# while building the config, even with the weights cached, and fails offline.
$server = Join-Path $here "server.py"
# cmd /c strips one outer pair of quotes, so wrap the whole line once more.
$cmd = "`"`"$Python`" -u `"$server`" --port $Port > `"$Log`" 2>&1`""
$p = Start-Process -FilePath cmd.exe -ArgumentList "/c $cmd" -WorkingDirectory $here -WindowStyle Hidden -PassThru
Write-Output "ov-detector starting (cmd PID $($p.Id)); log: $Log; health: http://127.0.0.1:$Port/health"
