param(
    [Parameter(Mandatory = $true)][string]$DumpPath,
    [Parameter(Mandatory = $true)][string]$TargetDatabaseUrl,
    [string]$PostgresBin = "",
    [switch]$CleanTarget,
    [Parameter(Mandatory = $true)][switch]$ConfirmRestore
)

. (Join-Path $PSScriptRoot "DeskDatabase.Common.ps1")

$DumpPath = Assert-DeskExplicitPath -Path $DumpPath -Label "DumpPath"
if (-not (Test-Path -LiteralPath $DumpPath -PathType Leaf)) { throw "Dump not found: $DumpPath" }
if (-not $ConfirmRestore) { throw "Restore requires -ConfirmRestore." }
$pgRestore = Resolve-DeskPostgresTool -Name "pg_restore" -PostgresBin $PostgresBin

$checksumFile = "$DumpPath.sha256"
if (Test-Path -LiteralPath $checksumFile) {
    $expected = ((Get-Content -LiteralPath $checksumFile -Raw).Trim() -split "\s+")[0].ToLowerInvariant()
    $actual = Get-DeskFileSha256 $DumpPath
    if ($actual -ne $expected) { throw "Dump checksum mismatch. Expected=$expected actual=$actual" }
}

$arguments = @(
    "--exit-on-error",
    "--no-owner",
    "--no-privileges",
    "--dbname", $TargetDatabaseUrl
)
if ($CleanTarget) { $arguments += @("--clean", "--if-exists") }
$arguments += $DumpPath
Invoke-DeskExternal -FilePath $pgRestore -Arguments $arguments
Write-Host "Desk database restored successfully."
