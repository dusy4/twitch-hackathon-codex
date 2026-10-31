$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'Packages/manifest.json') -Raw | ConvertFrom-Json
$packageDirectory = Join-Path $projectRoot 'LocalPackages'
New-Item -ItemType Directory -Path $packageDirectory -Force | Out-Null

foreach ($dependency in $manifest.dependencies.PSObject.Properties) {
    if ($dependency.Value -notlike 'file:../LocalPackages/*') { continue }
    $packageName = $dependency.Name
    $filename = $dependency.Value.Substring('file:../LocalPackages/'.Length)
    if ($packageName -notmatch '^com\.unity\.[a-z0-9.-]+$' -or
        $filename -notmatch ('^' + [regex]::Escape($packageName) + '-[0-9][a-zA-Z0-9.+-]*\.tgz$')) {
        throw "Unexpected local package reference: $packageName"
    }
    $destination = Join-Path $packageDirectory $filename
    if (Test-Path -LiteralPath $destination -PathType Leaf) { continue }
    $url = "https://packages.unity.com/$packageName/-/$filename"
    $temporary = "$destination.partial"
    try {
        Write-Host "Downloading $filename"
        Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $temporary
        Move-Item -LiteralPath $temporary -Destination $destination
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}
