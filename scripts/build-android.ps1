param([string[]]$Tasks = @('testDebugUnitTest', 'assembleDebug'))
$ErrorActionPreference = 'Stop'
$workspaceDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$toolDir = Join-Path $workspaceDir '.tools'
$tools = Get-Content -LiteralPath (Join-Path $toolDir 'android-toolchain.json') -Raw | ConvertFrom-Json
$env:JAVA_HOME = $tools.javaHome
$env:ANDROID_HOME = $tools.sdkRoot
$env:ANDROID_SDK_ROOT = $tools.sdkRoot
$env:ANDROID_USER_HOME = Join-Path $toolDir 'android-user'
$env:GRADLE_USER_HOME = Join-Path $toolDir 'gradle-cache'
Push-Location (Join-Path $workspaceDir 'apps/android')
try {
    & $tools.gradleExecutable '--no-daemon' @Tasks
    if ($LASTEXITCODE -ne 0) { throw "Android build failed ($LASTEXITCODE)" }
} finally { Pop-Location }
