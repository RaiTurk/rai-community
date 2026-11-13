param([string]$Npm = 'npm.cmd')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$tooling = Join-Path $root '.tooling/webview2'
$source = Join-Path $root 'desktop/webview2'
New-Item -ItemType Directory -Path $tooling -Force | Out-Null
$sdkPackage = Join-Path $tooling '1.0.4314.35.nupkg'
if (-not (Test-Path -LiteralPath $sdkPackage)) {
    $url = 'https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.4314.35/microsoft.web.webview2.1.0.4314.35.nupkg'
    $download = "$sdkPackage.download"
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $download
    if ((Get-FileHash -LiteralPath $download).Hash -ne '90778DEB1B77E36292828B4B5833C9255C27533F40E0DDD55891AE718944EDC4') {
        throw 'WebView2 SDK checksum mismatch.'
    }
    Move-Item -LiteralPath $download -Destination $sdkPackage
}
Copy-Item -LiteralPath (Join-Path $source 'package.json'), (Join-Path $source 'package-lock.json') -Destination $tooling
& $Npm ci --prefix $tooling --cache (Join-Path $tooling 'npm-cache') --ignore-scripts --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Could not install the pinned WebView2 packaging dependencies.' }
