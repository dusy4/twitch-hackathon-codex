$ErrorActionPreference = 'Stop'
$pluginTools = $PSScriptRoot
$androidPlayer = 'E:\Unity\Editors\6000.3.27f1\Editor\Data\PlaybackEngines\AndroidPlayer'
$env:TEMP = Join-Path $pluginTools 'checks'
$env:TMP = $env:TEMP
$env:ANDROID_USER_HOME = Join-Path $pluginTools 'checks\android'
New-Item -ItemType Directory -Force $env:ANDROID_USER_HOME | Out-Null
# Only the isolated plugin verification project is built. This opens no Unity
# editor, modifies no generated Unity Gradle project, and needs no unity.lock.
$gradleProject = Join-Path $pluginTools 'verify-gradle'
"sdk.dir=$($androidPlayer.Replace('\','/'))/SDK" | Set-Content -LiteralPath "$gradleProject\local.properties"
& "$androidPlayer\OpenJDK\bin\java.exe" -classpath "$androidPlayer\Tools\gradle\lib\gradle-launcher-9.3.1.jar" `
    org.gradle.launcher.GradleMain -p $gradleProject -g "$pluginTools\gradle-home" `
    :live:assembleRelease :smoke:assembleRelease :smoke:testDebugUnitTest --console=plain
if ($LASTEXITCODE -ne 0) { throw 'Standalone Gradle verification failed' }
python "$pluginTools\check-apk.py" "$pluginTools\verify-out\smoke\outputs\apk\release\smoke-release-unsigned.apk"
if ($LASTEXITCODE -ne 0) { throw 'APK privacy/license verification failed' }
