param([switch]$InstallSdk)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$workspaceDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$toolDir = Join-Path $workspaceDir '.tools'
New-Item -ItemType Directory $toolDir -Force | Out-Null

function Get-VerifiedArchive([string]$Url, [string]$ChecksumUrl, [string]$FileName) {
    $archive = Join-Path $toolDir $FileName
    $expected = (Invoke-WebRequest $ChecksumUrl).Content
    if ($expected -is [byte[]]) { $expected = [Text.Encoding]::UTF8.GetString($expected) }
    $checksum = [regex]::Match($expected, '(?i)\b[a-f0-9]{64}\b').Value
    if (!$checksum) { throw "No SHA256 checksum at $ChecksumUrl" }
    if (!(Test-Path -LiteralPath $archive)) { Write-Host "Downloading $FileName from its official distributor"; Invoke-WebRequest $Url -OutFile $archive }
    $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $checksum.ToLowerInvariant()) { throw "SHA256 mismatch: $FileName" }
    return @{ path = $archive; url = $Url; sha256 = $actual; verifiedAgainst = $ChecksumUrl }
}

$jdkUrl = 'https://aka.ms/download-jdk/microsoft-jdk-21.0.13.0.2-windows-x64.zip'
$jdkArchive = Get-VerifiedArchive $jdkUrl ($jdkUrl + '.sha256sum.txt') 'microsoft-jdk-21.0.13.0.2-windows-x64.zip'
$jdkDir = Join-Path $toolDir 'jdk21'
if (!(Test-Path -LiteralPath $jdkDir)) { Expand-Archive -LiteralPath $jdkArchive.path -DestinationPath $jdkDir }
$jdkInstall = Get-ChildItem -LiteralPath $jdkDir -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin/java.exe') } | Select-Object -First 1
if (!$jdkInstall) { throw 'JDK archive did not contain bin/java.exe' }

$gradleUrl = 'https://services.gradle.org/distributions/gradle-9.8.1-bin.zip'
$gradleArchive = Get-VerifiedArchive $gradleUrl ($gradleUrl + '.sha256') 'gradle-9.8.1-bin.zip'
$gradleDir = Join-Path $toolDir 'gradle-9.8.1'
if (!(Test-Path -LiteralPath $gradleDir)) { Expand-Archive -LiteralPath $gradleArchive.path -DestinationPath $toolDir }

$repositoryUrl = 'https://dl.google.com/android/repository/repository2-3.xml'
$repository = (Invoke-WebRequest $repositoryUrl).Content
if ($repository -is [byte[]]) { $repository = [Text.Encoding]::UTF8.GetString($repository) }
[xml]$repositoryXml = $repository
$package = $repositoryXml.SelectSingleNode("//*[local-name()='remotePackage' and @path='cmdline-tools;latest']")
if (!$package) { throw 'Official Android repository has no latest command-line tools' }
$windowsArchive = $package.SelectNodes(".//*[local-name()='archive']") | Where-Object { $_.SelectSingleNode("./*[local-name()='host-os']").InnerText -eq 'windows' } | Select-Object -First 1
$complete = $windowsArchive.SelectSingleNode("./*[local-name()='complete']")
$androidUrl = 'https://dl.google.com/android/repository/' + $complete.SelectSingleNode("./*[local-name()='url']").InnerText
if (([uri]$androidUrl).Host -ne 'dl.google.com') { throw 'Unexpected SDK distribution host' }
$androidChecksum = $complete.SelectSingleNode("./*[local-name()='checksum']").InnerText
$androidAlgorithm = if ($androidChecksum.Length -eq 64) { 'SHA256' } else { 'SHA1' }
$androidZip = Join-Path $toolDir 'android-commandline-tools.zip'
if (!(Test-Path -LiteralPath $androidZip)) { Write-Output 'Downloading official Android command-line tools'; Invoke-WebRequest $androidUrl -OutFile $androidZip }
if ((Get-FileHash -LiteralPath $androidZip -Algorithm $androidAlgorithm).Hash -ne $androidChecksum) { throw 'Android archive does not match its official repository checksum' }
$commandDir = Join-Path $toolDir 'android-commandline'
if (!(Test-Path -LiteralPath $commandDir)) { Expand-Archive -LiteralPath $androidZip -DestinationPath $commandDir }
$sdkDir = Join-Path $toolDir 'android-sdk'
New-Item -ItemType Directory $sdkDir -Force | Out-Null
$env:JAVA_HOME = $jdkInstall.FullName
$env:ANDROID_HOME = $sdkDir
$env:ANDROID_SDK_ROOT = $sdkDir
$env:ANDROID_USER_HOME = Join-Path $toolDir 'android-user'
$env:GRADLE_USER_HOME = Join-Path $toolDir 'gradle-cache'

$provenance = @{
    retrieved = (Get-Date).ToUniversalTime().ToString('o')
    jdk = $jdkArchive
    gradle = $gradleArchive
    android = @{ url = $androidUrl; repository = $repositoryUrl; checksumAlgorithm = $androidAlgorithm; checksum = $androidChecksum; sha256 = (Get-FileHash -LiteralPath $androidZip -Algorithm SHA256).Hash.ToLowerInvariant() }
    javaHome = $env:JAVA_HOME
    sdkRoot = $sdkDir
    gradleExecutable = Join-Path $gradleDir 'bin/gradle.bat'
}
$provenance | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $toolDir 'android-toolchain.json') -Encoding utf8
if ($InstallSdk) {
    $manager = Join-Path $commandDir 'cmdline-tools/bin/android.exe'
    # The current official tools replace sdkmanager with Android CLI and use slash package IDs.
    # Metrics are disabled. Standard SDK package terms apply; no account or payment is involved.
    & $manager '--no-metrics' "--sdk=$sdkDir" sdk install 'platform-tools' 'platforms/android-37.0' 'build-tools/36.0.0'
    if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath (Join-Path $sdkDir 'platforms/android-37.0/android.jar')) -or !(Test-Path -LiteralPath (Join-Path $sdkDir 'build-tools/36.0.0/aapt2.exe'))) { throw 'Android SDK package installation did not produce all required files' }
}
Write-Output 'Verified project-local Android build tools are ready; system PATH/JAVA_HOME were not changed.'
