param(
    [string]$DataRoot = "C:\ProgramData\DeskFutures"
)

. (Join-Path $PSScriptRoot "DeskDeployment.Common.ps1")

$envFile = Join-Path $DataRoot "config\desk.env"
if (-not (Test-Path -LiteralPath $envFile)) { throw "Desk environment missing: $envFile" }
$values = Read-DeskEnvFile $envFile
$objectRoot = $values["DESK_OBJECT_ROOT"]
if (-not $objectRoot) { throw "DESK_OBJECT_ROOT is missing from the Desk environment." }
$arguments = @{
    ObjectRoot = $objectRoot
    BackupDirectory = (Join-Path $DataRoot "backups")
    ReleaseVersion = $values["DESK_RELEASE_VERSION"]
}
if ($values.ContainsKey("DESK_BACKUP_OFFSITE_DIRECTORY") -and $values["DESK_BACKUP_OFFSITE_DIRECTORY"]) {
    $arguments["OffsiteDirectory"] = $values["DESK_BACKUP_OFFSITE_DIRECTORY"]
}
& (Join-Path $PSScriptRoot "database\Backup-DeskObjectStore.ps1") @arguments
