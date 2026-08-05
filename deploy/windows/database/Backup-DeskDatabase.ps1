param(
    [Parameter(Mandatory = $true)][string]$DatabaseUrl,
    [Parameter(Mandatory = $true)][string]$BackupDirectory,
    [string]$PostgresBin = "",
    [int]$RetentionDays = 14,
    [string]$OffsiteDirectory = "",
    [string]$AgeRecipient = "",
    [string]$ReleaseVersion = "unversioned"
)

. (Join-Path $PSScriptRoot "DeskDatabase.Common.ps1")

$BackupDirectory = Assert-DeskExplicitPath -Path $BackupDirectory -Label "BackupDirectory"
New-Item -ItemType Directory -Path $BackupDirectory -Force | Out-Null
$pgDump = Resolve-DeskPostgresTool -Name "pg_dump" -PostgresBin $PostgresBin
$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$dumpPath = Join-Path $BackupDirectory "desk-native-$stamp.dump"

Invoke-DeskExternal -FilePath $pgDump -Arguments @(
    "--format=custom", "--compress=9", "--no-owner", "--no-privileges",
    "--file", $dumpPath, "--dbname", $DatabaseUrl
)

$checksum = Get-DeskFileSha256 $dumpPath
$leaf = Split-Path $dumpPath -Leaf
[System.IO.File]::WriteAllText("$dumpPath.sha256", "$checksum  $leaf`n", [System.Text.UTF8Encoding]::new($false))
$metadata = [ordered]@{
    schema = "desk_postgres_backup_v1"
    created_at_utc = (Get-Date).ToUniversalTime().ToString("o")
    release_version = $ReleaseVersion
    file = $leaf
    sha256 = $checksum
    size_bytes = (Get-Item -LiteralPath $dumpPath).Length
    encrypted = $false
}
$metadata | ConvertTo-Json | Set-Content -LiteralPath "$dumpPath.json" -Encoding UTF8

$offsiteArtifacts = @($dumpPath, "$dumpPath.sha256", "$dumpPath.json")
if ($AgeRecipient) {
    $age = Get-Command "age.exe" -ErrorAction SilentlyContinue
    if (-not $age) { throw "age.exe is required when -AgeRecipient is supplied." }
    $encryptedPath = "$dumpPath.age"
    Invoke-DeskExternal -FilePath $age.Source -Arguments @("-r", $AgeRecipient, "-o", $encryptedPath, $dumpPath)
    $encryptedChecksum = Get-DeskFileSha256 $encryptedPath
    $encryptedLeaf = Split-Path $encryptedPath -Leaf
    [System.IO.File]::WriteAllText("$encryptedPath.sha256", "$encryptedChecksum  $encryptedLeaf`n", [System.Text.UTF8Encoding]::new($false))
    $encryptedMetadata = [ordered]@{
        schema = "desk_postgres_backup_v1"
        created_at_utc = $metadata.created_at_utc
        release_version = $ReleaseVersion
        file = $encryptedLeaf
        sha256 = $encryptedChecksum
        size_bytes = (Get-Item -LiteralPath $encryptedPath).Length
        encrypted = $true
    }
    $encryptedMetadata | ConvertTo-Json | Set-Content -LiteralPath "$encryptedPath.json" -Encoding UTF8
    $offsiteArtifacts = @($encryptedPath, "$encryptedPath.sha256", "$encryptedPath.json")
}

if ($OffsiteDirectory) {
    $OffsiteDirectory = Assert-DeskExplicitPath -Path $OffsiteDirectory -Label "OffsiteDirectory"
    New-Item -ItemType Directory -Path $OffsiteDirectory -Force | Out-Null
    Copy-Item -LiteralPath $offsiteArtifacts -Destination $OffsiteDirectory -Force
}

$cutoff = (Get-Date).ToUniversalTime().AddDays(-[Math]::Max(1, $RetentionDays))
Get-ChildItem -LiteralPath $BackupDirectory -File |
    Where-Object { $_.LastWriteTimeUtc -lt $cutoff -and $_.Name -like "desk-native-*" } |
    Remove-Item -Force

Write-Host "Backup completed: $dumpPath"
Write-Host "SHA256: $checksum"
