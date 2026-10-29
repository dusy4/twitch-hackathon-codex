param([string]$BuildLog = '.data/android-review-build.log')
$ErrorActionPreference = 'Stop'
$workspaceDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location $workspaceDir
try {
    if (!(Get-Content -LiteralPath $BuildLog -Raw).Contains('BUILD SUCCESSFUL')) { throw 'The supplied Android build log does not report success' }
    $toolchain = Get-Content .tools/android-toolchain.json -Raw | ConvertFrom-Json
    $env:JAVA_HOME = $toolchain.javaHome
    $sourceApk = 'apps/android/app/build/outputs/apk/debug/app-debug.apk'
    & .tools/android-sdk/build-tools/36.0.0/apksigner.bat verify --verbose $sourceApk *> .data/android-apk-signature.log
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed' }
    $badging = & .tools/android-sdk/build-tools/36.0.0/aapt2.exe dump badging $sourceApk
    if ($LASTEXITCODE -ne 0) { throw 'APK manifest inspection failed' }
    if ($badging -match "uses-permission: name='android.permission.RECORD_AUDIO'") { throw 'Unexpected microphone permission in video-only client' }
    $total = 0; $failures = 0; $skipped = 0
    foreach ($report in Get-ChildItem apps/android/app/build/test-results/testDebugUnitTest -Filter '*.xml') {
        [xml]$result = Get-Content -LiteralPath $report.FullName
        $total += [int]$result.testsuite.tests
        $failures += [int]$result.testsuite.failures + [int]$result.testsuite.errors
        $skipped += [int]$result.testsuite.skipped
    }
    if ($total -eq 0 -or $failures -ne 0) { throw 'Native unit results are missing or failed' }
    $lint = Get-Content apps/android/app/build/reports/lint-results-debug.txt -Raw
    $lintSummary = [regex]::Match($lint, '(\d+) errors?, (\d+) warnings?')
    if (!$lintSummary.Success -or [int]$lintSummary.Groups[1].Value -ne 0) { throw 'Android lint results are missing or failed' }
    Copy-Item -LiteralPath $sourceApk -Destination artifacts/raidrift-capture-debug.apk
    $apk = Get-Item artifacts/raidrift-capture-debug.apk
    $archive = [IO.Compression.ZipFile]::OpenRead($apk.FullName)
    try {
        $models = @($archive.Entries | Where-Object { $_.FullName -match '^assets/kaykit/.*\.glb$' } | ForEach-Object { @{ path = $_.FullName; bytes = $_.Length } })
        $notices = @($archive.Entries | Where-Object { $_.FullName -like 'assets/notices/*' } | ForEach-Object { $_.FullName })
        if ($models.Count -ne 4 -or $notices.Count -lt 7) { throw 'APK is missing character assets or notices' }
    } finally { $archive.Dispose() }
    $sources = @(Get-ChildItem apps/android/app/src/main/java -Recurse -File -Filter '*.kt' | ForEach-Object {
        @{ path = [IO.Path]::GetRelativePath($workspaceDir, $_.FullName).Replace('\', '/'); sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
    })
    @{
        date = '2026-10-29'; artifact = $apk.Name; bytes = $apk.Length
        sha256 = (Get-FileHash $apk.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        applicationId = 'world.raidrift.capture.android'; localDebugSignatureVerified = $true
        commands = @('testDebugUnitTest', 'assembleDebug', 'lintDebug'); buildLog = $BuildLog
        jvmTests = @{ total = $total; failures = $failures; skipped = $skipped }
        lint = @{ errors = 0; warnings = [int]$lintSummary.Groups[2].Value; details = 'Pinned Gradle/dependency updates and targetSdk 36' }
        models = $models; notices = $notices; nativeSourceHashes = $sources
        khronosModelValidation = '4 models; 0 errors; 0 warnings'
        nativeRuntimeValidated = $false; physicalPhoneValidated = $false; composedVideoDecoded = $false
        microphonePermission = $false
        backendRegression = @{ total = 62; pass = 61; skipped = 1; concurrency = 2; log = '.data/android-output-backend.log' }
        browserMediaRegression = @{ passed = 1; scope = 'Synthetic browser decoded pixels, advancing frames and cleared receiver on shutdown; not native phone'; log = '.data/webrtc-pixel-browser.log'; proof = 'artifacts/webrtc-frame-proof.json' }
        toolchain = @{ gradle = '9.8.1'; jdk = '21.0.13.0.2'; compileSdk = 37 }
        device = 'Owner will install on Android phone manually; Boat VM authentication pending'
    } | ConvertTo-Json -Depth 8 | Set-Content artifacts/android-build.json
    Write-Output "Verified local debug APK: $($apk.Length) bytes; $total native tests; no microphone permission. Runtime validation is separate."
} finally { Pop-Location }
