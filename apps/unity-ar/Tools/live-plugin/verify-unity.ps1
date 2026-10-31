param([ValidateSet('All','Compile','SelfTest','Apk')][string]$Mode = 'All')
$ErrorActionPreference = 'Stop'
$projectPath = 'E:\RaidRift-MR'
$unityPath = 'E:\Unity\Editors\6000.3.27f1\Editor\Unity.exe'
$lockPath = 'E:\Unity\tmp\unity.lock'
$env:TEMP = 'E:\Unity\tmp'
$env:TMP = $env:TEMP
$env:PATH = 'E:\Hermes\tools\git-2.53.0+3-win32-x64\cmd;' + $env:PATH
$env:GRADLE_USER_HOME = 'E:\Unity\gradle-home'
$lockHandle = $null
while ($null -eq $lockHandle) {
    try {
        $lockHandle = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::CreateNew,
            [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
        $owner = [System.Text.Encoding]::UTF8.GetBytes("live publisher verification PID=$PID")
        $lockHandle.Write($owner, 0, $owner.Length)
        $lockHandle.Flush()
    } catch [System.IO.IOException] {
        if (-not (Test-Path -LiteralPath $lockPath)) { throw }
        Write-Host 'Unity build lock is held; retrying in 60 seconds.'
        Start-Sleep -Seconds 60
    }
}
function Invoke-LiveUnity([string]$Log, [string]$Method) {
    $arguments = @('-batchmode','-projectPath', $projectPath, '-quit','-logFile', $Log)
    if ($Method) { $arguments += @('-executeMethod', $Method) }
    $process = Start-Process -FilePath $unityPath -ArgumentList $arguments -WindowStyle Hidden -PassThru -Wait
    if ($process.ExitCode -ne 0) { throw "Unity failed (exit $($process.ExitCode)); see $Log" }
}
try {
    if ($Mode -in @('All','Compile')) { Invoke-LiveUnity 'E:\Unity\tmp\live-compile.log' '' }
    if ($Mode -in @('All','SelfTest')) {
        Invoke-LiveUnity 'E:\Unity\tmp\live-selftest.log' 'RaidRift.EditorTools.LiveSelfTest.Run'
        if (-not (Select-String -LiteralPath 'E:\Unity\tmp\live-selftest.log' -SimpleMatch '[LiveSelfTest] PASS')) {
            throw 'LiveSelfTest did not report PASS'
        }
    }
    if ($Mode -in @('All','Apk')) { & "$projectPath\build.ps1" }
} finally {
    if ($null -ne $lockHandle) {
        $lockHandle.Dispose()
        Remove-Item -LiteralPath $lockPath
    }
}
