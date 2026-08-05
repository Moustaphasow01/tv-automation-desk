param(
    [Parameter(Mandatory = $true)][string]$ObjectRoot,
    [Parameter(Mandatory = $true)][string]$BackupDirectory,
    [int]$RetentionDays = 28,
    [string]$OffsiteDirectory = "",
    [string]$ReleaseVersion = "unversioned"
)

. (Join-Path $PSScriptRoot "DeskDatabase.Common.ps1")

$ObjectRoot = Assert-DeskExplicitPath -Path $ObjectRoot -Label "ObjectRoot"
$BackupDirectory = Assert-DeskExplicitPath -Path $BackupDirectory -Label "BackupDirectory"
if (-not (Test-Path -LiteralPath $ObjectRoot -PathType Container)) {
    throw "Desk object root does not exist: $ObjectRoot"
}
New-Item -ItemType Directory -Path $BackupDirectory -Force | Out-Null
$tar = Get-Command "tar.exe" -ErrorAction SilentlyContinue
if (-not $tar) { throw "tar.exe is required to archive the immutable object store." }

$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$archivePath = Join-Path $BackupDirectory "desk-objects-$stamp.tar.gz"
$temporaryPath = "$archivePath.partial"
if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath -Force }

try {
    & $tar.Source -czf $temporaryPath -C $ObjectRoot .
    if ($LASTEXITCODE -ne 0) { throw "Object archive creation failed with exit code $LASTEXITCODE." }
    Move-Item -LiteralPath $temporaryPath -Destination $archivePath -Force
} finally {
    if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath -Force }
}

$checksum = Get-DeskFileSha256 $archivePath
$leaf = Split-Path $archivePath -Leaf
[System.IO.File]::WriteAllText("$archivePath.sha256", "$checksum  $leaf`n", [System.Text.UTF8Encoding]::new($false))
$metadata = [ordered]@{
    schema = "desk_object_backup_v1"
    created_at_utc = (Get-Date).ToUniversalTime().ToString("o")
    release_version = $ReleaseVersion
    source_root = $ObjectRoot
    file = $leaf
    sha256 = $checksum
    size_bytes = (Get-Item -LiteralPath $archivePath).Length
}
$metadata | ConvertTo-Json | Set-Content -LiteralPath "$archivePath.json" -Encoding UTF8

if ($OffsiteDirectory) {
    $OffsiteDirectory = Assert-DeskExplicitPath -Path $OffsiteDirectory -Label "OffsiteDirectory"
    New-Item -ItemType Directory -Path $OffsiteDirectory -Force | Out-Null
    Copy-Item -LiteralPath @($archivePath, "$archivePath.sha256", "$archivePath.json") -Destination $OffsiteDirectory -Force
}

$cutoff = (Get-Date).ToUniversalTime().AddDays(-[Math]::Max(7, $RetentionDays))
Get-ChildItem -LiteralPath $BackupDirectory -File |
    Where-Object { $_.LastWriteTimeUtc -lt $cutoff -and $_.Name -like "desk-objects-*" } |
    Remove-Item -Force

Write-Host "Immutable object backup completed: $archivePath"
Write-Host "SHA256: $checksum"
