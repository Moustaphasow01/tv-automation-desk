param(
    [Parameter(Mandatory = $true)][string]$DatabaseDump,
    [Parameter(Mandatory = $true)][string]$ObjectArchive,
    [Parameter(Mandatory = $true)][string]$TargetDatabaseUrl,
    [Parameter(Mandatory = $true)][string]$TargetObjectRoot,
    [string]$PostgresBin = "",
    [switch]$ConfirmRecovery
)

. (Join-Path $PSScriptRoot "DeskDeployment.Common.ps1")
. (Join-Path $PSScriptRoot "database\DeskDatabase.Common.ps1")

if (-not $ConfirmRecovery) { throw "Disaster recovery requires -ConfirmRecovery." }
$DatabaseDump = Assert-DeskDeploymentPath -Path $DatabaseDump -Label "DatabaseDump"
$ObjectArchive = Assert-DeskDeploymentPath -Path $ObjectArchive -Label "ObjectArchive"
$TargetObjectRoot = Assert-DeskDeploymentPath -Path $TargetObjectRoot -Label "TargetObjectRoot"
foreach ($artifact in @($DatabaseDump, $ObjectArchive)) {
    if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) { throw "Recovery artifact missing: $artifact" }
    $checksumPath = "$artifact.sha256"
    if (-not (Test-Path -LiteralPath $checksumPath -PathType Leaf)) { throw "Recovery checksum missing: $checksumPath" }
    $expected = ((Get-Content -LiteralPath $checksumPath -Raw).Trim() -split "\s+")[0].ToLowerInvariant()
    $actual = Get-DeskFileSha256 $artifact
    if ($expected -ne $actual) { throw "Recovery checksum mismatch: $artifact" }
}
if (Test-Path -LiteralPath $TargetObjectRoot) {
    $existing = @(Get-ChildItem -LiteralPath $TargetObjectRoot -Force)
    if ($existing.Count -gt 0) { throw "TargetObjectRoot must be empty: $TargetObjectRoot" }
} else {
    New-Item -ItemType Directory -Path $TargetObjectRoot -Force | Out-Null
}

& (Join-Path $PSScriptRoot "database\Restore-DeskDatabase.ps1") `
    -DumpPath $DatabaseDump `
    -TargetDatabaseUrl $TargetDatabaseUrl `
    -PostgresBin $PostgresBin `
    -CleanTarget `
    -ConfirmRestore

$tar = Get-Command "tar.exe" -ErrorAction SilentlyContinue
if (-not $tar) { throw "tar.exe is required for object-store recovery." }
& $tar.Source -xzf $ObjectArchive -C $TargetObjectRoot
if ($LASTEXITCODE -ne 0) { throw "Object-store recovery failed with exit code $LASTEXITCODE." }

& (Join-Path $PSScriptRoot "database\Test-DeskDatabase.ps1") `
    -DatabaseUrl $TargetDatabaseUrl `
    -PostgresBin $PostgresBin `
    -RequireBrokerSchema

Write-Host "Disaster recovery completed and validated."
Write-Host "Database: restored"
Write-Host "Immutable objects: $TargetObjectRoot"
