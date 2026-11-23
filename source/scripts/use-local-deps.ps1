param(
    [Parameter(Mandatory = $true)]
    [string]$Source
)
$ErrorActionPreference = 'Stop'
$Project = Split-Path -Parent $PSScriptRoot
$Destination = Join-Path $Project 'node_modules'
$Manifest = Get-Content -LiteralPath (Join-Path $Project 'package.json') -Raw | ConvertFrom-Json
$Packages = @($Manifest.dependencies.PSObject.Properties) + @($Manifest.devDependencies.PSObject.Properties)

function Test-InstalledPackages([string]$Directory) {
    foreach ($Package in $Packages) {
        $PackageFile = Join-Path $Directory "$($Package.Name)/package.json"
        if (!(Test-Path -LiteralPath $PackageFile)) { return $false }
        $Installed = Get-Content -LiteralPath $PackageFile -Raw | ConvertFrom-Json
        if ($Installed.version -ne $Package.Value) { return $false }
    }
    return $true
}

if (Test-InstalledPackages $Destination) {
    Write-Host "Локальные пакеты уже подключены: $Destination"
    return
}
$DependencyPath = (Resolve-Path -LiteralPath $Source).Path
if (!(Test-InstalledPackages $DependencyPath)) { throw "Версии пакетов в '$DependencyPath' должны совпадать с package.json." }
& robocopy $DependencyPath $Destination /E /XD .vite .vite-temp /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Ошибка копирования: $LASTEXITCODE" }
Write-Host "Скопированы существующие пакеты: $DependencyPath"
exit 0
