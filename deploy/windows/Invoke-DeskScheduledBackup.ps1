param(
    [string]$DataRoot = "C:\ProgramData\DeskFutures",
    [string]$PostgresBin = ""
)

. (Join-Path $PSScriptRoot "DeskDeployment.Common.ps1")

$envFile = Join-Path $DataRoot "config\desk.env"
if (-not (Test-Path -LiteralPath $envFile)) { throw "Desk environment missing: $envFile" }
$values = Read-DeskEnvFile $envFile
$arguments = @{
    DatabaseUrl = $values["DATABASE_URL"]
    BackupDirectory = (Join-Path $DataRoot "backups")
    PostgresBin = $PostgresBin
    ReleaseVersion = $values["DESK_RELEASE_VERSION"]
}
if ($values.ContainsKey("DESK_BACKUP_OFFSITE_DIRECTORY") -and $values["DESK_BACKUP_OFFSITE_DIRECTORY"]) {
    $arguments["OffsiteDirectory"] = $values["DESK_BACKUP_OFFSITE_DIRECTORY"]
}
if ($values.ContainsKey("DESK_BACKUP_AGE_RECIPIENT") -and $values["DESK_BACKUP_AGE_RECIPIENT"]) {
    $arguments["AgeRecipient"] = $values["DESK_BACKUP_AGE_RECIPIENT"]
}
& (Join-Path $PSScriptRoot "database\Backup-DeskDatabase.ps1") @arguments
