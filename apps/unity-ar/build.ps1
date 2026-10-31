# Builds the RaidRift MR (Unity) APK in batch mode and publishes it to the Tailscale APK share.
# Usage: powershell -File apps/unity-ar/build.ps1 [-Publish]
param([switch]$Publish)
$ErrorActionPreference = 'Stop'
$project = $PSScriptRoot
$version = (Select-String -Path "$project\Assets\RaidRift\Editor\BuildTools.cs" -Pattern 'Version = "([^"]+)"').Matches[0].Groups[1].Value

$candidates = @(
  "E:\Unity\Editors\6000.3.27f1\Editor\Unity.exe",
  "C:\Program Files\Unity\Hub\Editor\6000.3.27f1\Editor\Unity.exe",
  "$env:LOCALAPPDATA\Programs\Unity\Hub\Editor\6000.3.27f1\Editor\Unity.exe"
)
$unity = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $unity) {
  $unity = Get-ChildItem "E:\Unity\Editors","C:\Program Files\Unity\Hub\Editor" -Recurse -Depth 3 -Filter Unity.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $unity) { throw "Unity 6000.3 editor not found. Install it with Unity Hub (Android Build Support + OpenJDK + Android SDK & NDK)." }

$log = Join-Path $env:TEMP "raidrift-unity-build.log"
Write-Host "Unity: $unity"
Write-Host "Log:   $log"
$p = Start-Process -FilePath $unity -ArgumentList @('-batchmode','-quit','-projectPath',"`"$project`"",'-buildTarget','Android','-executeMethod','RaidRift.EditorTools.BuildTools.BuildAndroid','-logFile',"`"$log`"") -Wait -PassThru -NoNewWindow
Select-String -Path $log -Pattern 'error CS|\[RaidRift\]|Build (Succeeded|Failed)|No valid Unity Editor license|Exception' | Select-Object -Last 40 | ForEach-Object { $_.Line }
if ($p.ExitCode -ne 0) { throw "Unity build failed (exit $($p.ExitCode)); see $log" }

$apk = Join-Path $project "Builds\RaidRift-unity-$version.apk"
if (-not (Test-Path $apk)) { throw "APK missing: $apk" }
Write-Host "Built $apk ($([int]((Get-Item $apk).Length/1MB)) MB)"
if ($Publish) {
  $name = "RaidRift-MR-$version.apk"
  Copy-Item $apk "E:\Hermes\share\raidrift-apk\$name" -Force
  Copy-Item $apk "$env:USERPROFILE\Desktop\$name" -Force
  $h = (Get-FileHash $apk -Algorithm SHA256).Hash.ToLower()
  "$h  $name" | Out-File -Encoding ascii "E:\Hermes\share\raidrift-apk\$name.sha256"
  Write-Host "Published https://raidrift-pc.tail7252b4.ts.net/apk/$name"
}
